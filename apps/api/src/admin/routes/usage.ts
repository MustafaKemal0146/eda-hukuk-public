// `/api/v1/admin/usage` ve `/api/v1/admin/limits*` (053-ekranlar/11 §3.7): platform ve büro bazlı
// token/maliyet kullanımı, platform limit görünümü ve büro limit geçersiz kılma. Okuma `platform:usage_read`
// ve `platform:system_settings_read`; yazma `platform:system_settings_write` + step-up. Yanıtlar `no-store`.
import {
  AdminLimitsResponse,
  AdminUsageResponse,
  LimitsQuery,
  OrgLimitParams,
  OrgLimitResult,
  SetOrgLimitInput,
  USAGE_MAX_RANGE_DAYS,
  UsageQuery,
} from '@eda/contracts/api/admin-usage';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { jsonBody, queryOf, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { AdminUsageService } from '../usage-service.ts';
import { ADMIN_READ } from './me.ts';

const DAY_MS = 86_400_000;

const actorOf = (c: { get: (k: 'user') => unknown }): string => {
  const u = c.get('user') as { id: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return u.id;
};

/** Gün sınırı veritabanında Europe/Istanbul'dur; burada yalnız takvim günü farkı denetlenir. */
function rangeOf(q: { from: string; to: string }): void {
  const a = Date.parse(`${q.from}T00:00:00Z`);
  const b = Date.parse(`${q.to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || (b - a) / DAY_MS > USAGE_MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
  }
}

export function mountAdminUsage(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AdminUsageService,
): void {
  const base = '/api/v1/admin';
  const usageRead: RouteMeta = { ...ADMIN_READ, permission: 'platform:usage_read' };
  const limitsRead: RouteMeta = { ...ADMIN_READ, permission: 'platform:system_settings_read' };
  const limitsWrite: RouteMeta = {
    ...ADMIN_READ,
    permission: 'platform:system_settings_write',
    stepUp: true,
    body: 'json',
  };
  const limitsClear: RouteMeta = { ...limitsWrite, body: 'none' };

  registry.add('get', `${base}/usage`, usageRead);
  app.get(`${base}/usage`, async (c) => {
    const q = queryOf(c, UsageQuery);
    rangeOf(q);
    return send(c, AdminUsageResponse, await svc.usage(actorOf(c), q.from, q.to, q.orgId ?? null));
  });

  registry.add('get', `${base}/limits`, limitsRead);
  app.get(`${base}/limits`, async (c) => {
    const q = queryOf(c, LimitsQuery);
    return send(c, AdminLimitsResponse, await svc.limits(actorOf(c), q.orgId ?? null));
  });

  registry.add('put', `${base}/limits/orgs/{orgId}/{key}`, limitsWrite);
  app.put(`${base}/limits/orgs/:orgId/:key`, async (c) => {
    const p = OrgLimitParams.safeParse(c.req.param());
    if (!p.success) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    const input = await jsonBody(c, SetOrgLimitInput);
    return send(
      c,
      OrgLimitResult,
      await svc.setOrgLimit(actorOf(c), p.data.orgId, p.data.key, input.value),
    );
  });

  registry.add('delete', `${base}/limits/orgs/{orgId}/{key}`, limitsClear);
  app.delete(`${base}/limits/orgs/:orgId/:key`, async (c) => {
    const p = OrgLimitParams.safeParse(c.req.param());
    if (!p.success) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    return send(c, OrgLimitResult, await svc.clearOrgLimit(actorOf(c), p.data.orgId, p.data.key));
  });
}
