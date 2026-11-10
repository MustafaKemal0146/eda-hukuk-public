// `/api/v1/admin/audit/*` (053-ekranlar/11 "Denetim"): denetim günlüğü ve hata özeti. Okuma izni
// `platform:audit_read` (super_admin + support); step-up gerekliliği izin tablosundaki metadan gelir.
import {
  AuditErrorsQuery,
  AuditErrorsResponse,
  AuditEventsQuery,
  AuditEventsResponse,
  AuditLoginFailuresResponse,
} from '@eda/contracts/api/admin-audit';
import { AppError } from '@eda/contracts/errors';
import { PERMISSIONS } from '@eda/contracts/permissions';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { queryOf, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { AdminAuditService } from '../audit-service.ts';
import { ADMIN_READ } from './me.ts';

const MAX_RANGE_DAYS = 92;
const dayMs = 86_400_000;

const actorOf = (c: { get: (k: 'user') => unknown }): string => {
  const u = c.get('user') as { id: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return u.id;
};

function rangeOf(from: string, to: string): void {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || (b - a) / dayMs > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
  }
}

export function mountAdminAudit(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AdminAuditService,
): void {
  const base = '/api/v1/admin/audit';
  const read: RouteMeta = {
    ...ADMIN_READ,
    permission: 'platform:audit_read',
    stepUp: PERMISSIONS['platform:audit_read'].stepUp,
  };

  registry.add('get', `${base}/events`, read);
  app.get(`${base}/events`, async (c) => {
    const q = queryOf(c, AuditEventsQuery);
    if ((q.from === undefined) !== (q.to === undefined)) {
      throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
    }
    if (q.from !== undefined && q.to !== undefined) rangeOf(q.from, q.to);
    return send(c, AuditEventsResponse, await svc.listEvents(actorOf(c), q));
  });

  registry.add('get', `${base}/errors`, read);
  app.get(`${base}/errors`, async (c) => {
    const q = queryOf(c, AuditErrorsQuery);
    rangeOf(q.from, q.to);
    return send(c, AuditErrorsResponse, await svc.errorSummary(actorOf(c), q.from, q.to));
  });

  registry.add('get', `${base}/login-failures`, read);
  app.get(`${base}/login-failures`, async (c) =>
    send(c, AuditLoginFailuresResponse, await svc.loginFailures(actorOf(c))),
  );
}
