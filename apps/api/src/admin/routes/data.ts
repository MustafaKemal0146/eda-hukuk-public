// `/api/v1/admin/*` veri uçları (053-ekranlar/11 §5): Pano özeti, başvuru kuyruğu ve kararı,
// istatistikler. Yazma uçları `stepUp: true` ister (passkey ile yeniden doğrulama). Yanıtlar `no-store`.
import {
  AdminApplicationListResponse,
  AdminOverviewDto,
  AdminStatsResponse,
  DecisionResult,
  ListApplicationsQuery,
  RejectApplicationInput,
  StatsQuery,
} from '@eda/contracts/api/admin';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { jsonBody, queryOf, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { AdminService } from '../service.ts';
import { ADMIN_READ } from './me.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const actorOf = (c: { get: (k: 'user') => unknown }): string => {
  const u = c.get('user') as { id: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return u.id;
};

const MAX_RANGE_DAYS = 92;
const dayMs = 86_400_000;

function rangeOf(q: { from: string; to: string }): void {
  const a = Date.parse(`${q.from}T00:00:00Z`);
  const b = Date.parse(`${q.to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || (b - a) / dayMs > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
  }
}

export function mountAdminData(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AdminService,
): void {
  const base = '/api/v1/admin';
  const usage: RouteMeta = { ...ADMIN_READ, permission: 'platform:usage_read' };
  // `platform:application_review` izin tablosunda step-up ister (okuma dahil; 042 §8.4).
  const review: RouteMeta = {
    ...ADMIN_READ,
    permission: 'platform:application_review',
    stepUp: true,
  };
  const reviewWrite: RouteMeta = { ...review, body: 'json' };

  registry.add('get', `${base}/overview`, usage);
  app.get(`${base}/overview`, async (c) =>
    send(c, AdminOverviewDto, await svc.overview(actorOf(c))),
  );

  registry.add('get', `${base}/stats`, usage);
  app.get(`${base}/stats`, async (c) => {
    const q = queryOf(c, StatsQuery);
    rangeOf(q);
    return send(c, AdminStatsResponse, await svc.stats(actorOf(c), q.from, q.to));
  });

  registry.add('get', `${base}/applications`, review);
  app.get(`${base}/applications`, async (c) =>
    send(
      c,
      AdminApplicationListResponse,
      await svc.listApplications(actorOf(c), queryOf(c, ListApplicationsQuery)),
    ),
  );

  registry.add('post', `${base}/applications/{userId}/approve`, reviewWrite);
  app.post(`${base}/applications/:userId/approve`, async (c) => {
    const userId = c.req.param('userId');
    if (!UUID_RE.test(userId)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    return send(c, DecisionResult, await svc.decide(actorOf(c), userId, 'approved'));
  });

  registry.add('post', `${base}/applications/{userId}/reject`, reviewWrite);
  app.post(`${base}/applications/:userId/reject`, async (c) => {
    const userId = c.req.param('userId');
    if (!UUID_RE.test(userId)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    const input = await jsonBody(c, RejectApplicationInput);
    return send(
      c,
      DecisionResult,
      await svc.decide(actorOf(c), userId, 'rejected', input.reasonCode),
    );
  });
}
