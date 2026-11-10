// `/api/v1/org*` uçları (002 §15 "Büro"; 042 §4; P04b). Meta: `GET /org` `mfa: exempt` (kurulum
// yapılabilsin; 042 §5.1); davet/üye uçları `mfa: policy`; `POST /org/invitations`
// `idempotency: required`; üye rolü/durumu ve çıkarma `stepUp: true` (`org:member_manage`; 042 §6.2).
// Davet kimliği yanıtlarda dönmez; `DELETE /org/invitations/:invitationId` parametresi `ref`'tir
//. Yanıtlar `Cache-Control: no-store` ve contracts şemalarıyla doğrulanır.
import {
  InvitationCanceledDto,
  InvitationCreatedDto,
  InvitationCreateInput,
  InvitationListDto,
  InvitationRef,
  MemberDto,
  MemberListDto,
  MemberPatchInput,
  MemberRemovedDto,
  OrgDto,
} from '@eda/contracts/api/org';
import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { SurfaceEnv } from '../../context/types.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { OrgActor, OrgService } from '../../services/org/org.ts';

const BASE: RouteMeta = {
  permission: 'org:read',
  tenant: 'required',
  allowVerification: 'pending',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

const Uuid = z.uuid();

function actor(c: Context<SurfaceEnv>): OrgActor {
  const t = c.get('tenant');
  const u = c.get('user');
  if (t === null || t === undefined || u === undefined) throw new AppError('ORG_NO_ACTIVE');
  return {
    orgId: t.orgId,
    userId: t.userId,
    memberRole: t.memberRole,
    orgKind: t.orgKind,
    verificationStatus: u.verificationStatus,
  };
}

async function body<T>(c: Context<SurfaceEnv>, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new AppError('VALIDATION_MALFORMED_BODY');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      fields: parsed.error.issues.slice(0, 20).map((i) => ({
        path: ['body', ...i.path.map(String)].join('.'),
        issue: fieldIssueOf(i),
      })),
    });
  }
  return parsed.data;
}

function param(c: Context<SurfaceEnv>, name: string, schema: z.ZodType<string>): string {
  const v = schema.safeParse(c.req.param(name));
  if (!v.success) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: `path.${name}`, issue: 'invalid_format' }],
    });
  }
  return v.data;
}

function send<T>(c: Context<SurfaceEnv>, schema: z.ZodType<T>, dto: T, status: 200 | 201 = 200) {
  c.header('Cache-Control', 'no-store');
  return c.json(schema.parse(dto) as object, status);
}

export function mountOrg(app: Hono<SurfaceEnv>, registry: RouteRegistry, svc: OrgService): void {
  registry.add('get', '/api/v1/org', { ...BASE, mfa: 'exempt' });
  app.get('/api/v1/org', async (c) => send(c, OrgDto, await svc.getOrg(actor(c))));

  const invite = { ...BASE, permission: 'org:member_invite' };
  registry.add('get', '/api/v1/org/invitations', invite);
  app.get('/api/v1/org/invitations', async (c) =>
    send(c, InvitationListDto, await svc.listInvitations(actor(c))),
  );

  registry.add(
    'post',
    '/api/v1/org/invitations',
    { ...invite, allowVerification: 'verified', idempotency: 'required', body: 'json' },
    { response: InvitationCreatedDto },
  );
  app.post('/api/v1/org/invitations', async (c) => {
    const input = await body(c, InvitationCreateInput);
    return send(c, InvitationCreatedDto, await svc.createInvitation(actor(c), input), 201);
  });

  registry.add('delete', '/api/v1/org/invitations/{invitationId}', {
    ...invite,
    allowVerification: 'verified',
  });
  app.delete('/api/v1/org/invitations/:invitationId', async (c) => {
    const ref = param(c, 'invitationId', InvitationRef);
    return send(c, InvitationCanceledDto, await svc.cancelInvitation(actor(c), ref));
  });

  registry.add('get', '/api/v1/org/members', { ...BASE, permission: 'org:member_read' });
  app.get('/api/v1/org/members', async (c) =>
    send(c, MemberListDto, await svc.listMembers(actor(c))),
  );

  const manage: RouteMeta = {
    ...BASE,
    permission: 'org:member_manage',
    allowVerification: 'verified',
    stepUp: true,
  };
  registry.add('patch', '/api/v1/org/members/{memberId}', { ...manage, body: 'json' });
  app.patch('/api/v1/org/members/:memberId', async (c) => {
    const id = param(c, 'memberId', Uuid);
    const input = await body(c, MemberPatchInput);
    return send(c, MemberDto, await svc.patchMember(actor(c), id, input));
  });

  registry.add('delete', '/api/v1/org/members/{memberId}', manage);
  app.delete('/api/v1/org/members/:memberId', async (c) => {
    const id = param(c, 'memberId', Uuid);
    return send(c, MemberRemovedDto, await svc.removeMember(actor(c), id));
  });
}
