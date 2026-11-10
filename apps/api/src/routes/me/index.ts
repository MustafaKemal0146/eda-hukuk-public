// `GET /api/v1/me` ve `POST /api/v1/me/lawyer-application` (041 §3.3; 042 §3.2 "Hesap ve destek"
// grubu: `self`, `allowVerification: any`, `tenant: optional`, `mfa: exempt`). Yanıtlar
// `Cache-Control: no-store`. İdempotency ara katmanı P04b'de kurulur; o zamana dek başvuru ucu
// `idempotency: none` ile açılır (yeniden gönderim zaten upsert'tir).

import type { LawyerApplicationResultDto } from '@eda/contracts/api/auth';
import { type LawyerApplicationInput, LawyerApplicationSchema } from '@eda/contracts/api/auth';
import type { MeDto } from '@eda/contracts/api/me';
import { AppError, fieldIssueOf } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SessionVar, SurfaceEnv, TenantVar, UserVar } from '../../context/types.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';

export const ME_META: RouteMeta = {
  permission: 'self',
  tenant: 'optional',
  allowVerification: 'any',
  mfa: 'exempt',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

export interface MeRouteContext {
  readonly session: SessionVar;
  readonly user: UserVar;
  readonly tenant: TenantVar | null;
}

export interface MeRouteDeps {
  me(ctx: MeRouteContext): Promise<MeDto>;
  applyLawyer(
    ctx: MeRouteContext,
    input: LawyerApplicationInput,
  ): Promise<LawyerApplicationResultDto>;
}

function context(c: { get: (k: 'session' | 'user' | 'tenant') => unknown }): MeRouteContext {
  const session = c.get('session') as SessionVar | undefined;
  const user = c.get('user') as UserVar | undefined;
  if (session === undefined || user === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return { session, user, tenant: (c.get('tenant') as TenantVar | null | undefined) ?? null };
}

export function mountMe(app: Hono<SurfaceEnv>, registry: RouteRegistry, deps: MeRouteDeps): void {
  registry.add('get', '/api/v1/me', ME_META);
  app.get('/api/v1/me', async (c) => {
    const dto = await deps.me(context(c));
    c.header('Cache-Control', 'no-store');
    return c.json(dto);
  });

  registry.add('post', '/api/v1/me/lawyer-application', { ...ME_META, body: 'json' });
  app.post('/api/v1/me/lawyer-application', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw new AppError('VALIDATION_MALFORMED_BODY');
    }
    const parsed = LawyerApplicationSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError('VALIDATION_FAILED', {
        fields: parsed.error.issues.slice(0, 20).map((i) => ({
          path: ['body', ...i.path.map(String)].join('.'),
          issue: fieldIssueOf(i),
        })),
      });
    }
    const dto = await deps.applyLawyer(context(c), parsed.data);
    c.header('Cache-Control', 'no-store');
    return c.json(dto);
  });
}
