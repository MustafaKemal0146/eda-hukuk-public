// Sohbet uçları (002 §15; 022 §2). Kimlik zinciri kuruluysa uçlar oturum + büro + MFA kapısından
// geçer ve sohbetler kullanıcıya ait satırlardır (RLS). Zincir yoksa (kimliksiz geliştirme/test
// dilimi) bellek içi depoyla ve zincir muafiyetiyle çalışır.
import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import { ChatStopRequest, ChatTurnRequest } from '@eda/contracts/stream';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type { ChatActor } from '../chat/persistence.ts';
import type { ChatDeps } from '../chat/turn.ts';
import { runTurn, stopTurn } from '../chat/turn.ts';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import { tenantActor } from './helpers.ts';

/** Geliştirme dilimi: kimlik zinciri ve census muafiyeti; yalnız kimliksiz dilimde. */
const DEV_SLICE = { devSlice: true } as const;

const AUTH_META: RouteMeta = {
  permission: 'chat:use',
  tenant: 'required',
  allowVerification: 'verified',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'chat',
  body: 'none',
  timeout: 'default',
};
const SLICE_META: RouteMeta = {
  ...AUTH_META,
  tenant: 'none',
  allowVerification: 'any',
  mfa: 'exempt',
  body: 'json',
};

async function parseBody<S extends z.ZodType>(schema: S, req: Request): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError('VALIDATION_FAILED', { fields: [{ path: 'body', issue: 'invalid_type' }] });
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    throw new AppError('VALIDATION_FAILED', {
      fields: r.error.issues.slice(0, 20).map((i) => ({
        path: ['body', ...i.path.map(String)].join('.'),
        issue: fieldIssueOf(i),
      })),
    });
  }
  return r.data;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function idParam(id: string): string {
  if (!UUID.test(id)) throw new AppError('CHAT_CONVERSATION_NOT_FOUND');
  return id;
}

export function mountConversations(app: Hono<SurfaceEnv>, registry: RouteRegistry, deps: ChatDeps) {
  const base = '/api/v1/conversations';
  const authed = deps.persistence.kind === 'pg';
  const META = authed ? AUTH_META : SLICE_META;
  const opts = authed ? undefined : DEV_SLICE;
  const actorOf = (c: Context<SurfaceEnv>): ChatActor => {
    if (!authed) return { orgId: 'dev', userId: 'dev' };
    const a = tenantActor(c);
    return { orgId: a.orgId, userId: a.userId };
  };

  registry.add('post', base, META, opts);
  app.post(base, async (c) => {
    const id = deps.uuid();
    await deps.persistence.create(actorOf(c), id);
    c.header('Cache-Control', 'no-store');
    return c.json({ id }, 201);
  });

  registry.add('get', base, { ...META, body: 'none' }, opts);
  app.get(base, async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json({ items: await deps.persistence.list(actorOf(c)) });
  });

  registry.add('get', `${base}/{conversationId}`, { ...META, body: 'none' }, opts);
  app.get(`${base}/:conversationId`, async (c) => {
    const id = idParam(c.req.param('conversationId'));
    const conv = await deps.persistence.load(actorOf(c), id);
    if (!conv) throw new AppError('CHAT_CONVERSATION_NOT_FOUND');
    c.header('Cache-Control', 'no-store');
    return c.json({
      id: conv.id,
      title: conv.title,
      messages: conv.ui,
      streamingMessageId: deps.active.get(id)?.messageId ?? null,
    });
  });

  registry.add('delete', `${base}/{conversationId}`, { ...META, body: 'none' }, opts);
  app.delete(`${base}/:conversationId`, async (c) => {
    const id = idParam(c.req.param('conversationId'));
    // Akışı süren sohbet silinmez: önce durdurulmalıdır (yarım tur silinen sohbete yazılmasın).
    const running = deps.active.get(id);
    if (running) {
      throw new AppError('CHAT_STREAM_IN_PROGRESS', { meta: { messageId: running.messageId } });
    }
    const result = await deps.persistence.remove(actorOf(c), id);
    if (result === 'not_found') throw new AppError('CHAT_CONVERSATION_NOT_FOUND');
    if (result === 'legal_hold')
      throw new AppError('CHAT_DELETE_BLOCKED', { reason: 'legal_hold' });
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });

  registry.add(
    'post',
    `${base}/{conversationId}/messages`,
    { ...META, body: 'json', clientData: true, timeout: 'stream' },
    opts,
  );
  app.post(`${base}/:conversationId/messages`, async (c) => {
    const id = idParam(c.req.param('conversationId'));
    const body = await parseBody(ChatTurnRequest, c.req.raw);
    return runTurn(deps, actorOf(c), id, body, c.var.requestId);
  });

  registry.add('post', `${base}/{conversationId}/stop`, { ...META, body: 'json' }, opts);
  app.post(`${base}/:conversationId/stop`, async (c) => {
    const id = idParam(c.req.param('conversationId'));
    const body = await parseBody(ChatStopRequest, c.req.raw);
    // Etkin tur yalnız bu sohbetin sahibine aittir: önce yükleme (varlık/sahiplik).
    const conv = await deps.persistence.load(actorOf(c), id);
    if (!conv) throw new AppError('CHAT_CONVERSATION_NOT_FOUND');
    return c.json(stopTurn(deps, id, body.messageId));
  });
}
