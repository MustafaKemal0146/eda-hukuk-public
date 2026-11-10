// `/api/v1/admin/announcements*` ve `/api/v1/admin/notifications/summary` (053-ekranlar/11 "Duyurular";
// 041 §9.11). Okuma uçları oturumlu personele açıktır (`support` dahil, salt okur); yazma uçları
// `platform:maintenance` (yalnız `super_admin`, step-up) ister ve her biri denetim kaydı üretir.
// İzin tablosunda duyuruya özgü izin yoktur (042 §8.4); ayrı izin planda onaylanana dek planlı bakım
// izni kullanılır (rapor notu).
import {
  AdminAnnouncementListResponse,
  AdminNotificationSummaryResponse,
  AnnouncementIdResult,
  CreateAnnouncementInput,
  ListAnnouncementsQuery,
  NotificationSummaryQuery,
  UpdateAnnouncementInput,
} from '@eda/contracts/api/admin-announcements';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { jsonBody, queryOf, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { AdminAnnouncementsService } from '../announcements-service.ts';
import { ADMIN_READ } from './me.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_RANGE_DAYS = 92;
const DAY_MS = 86_400_000;

const actorOf = (c: { get: (k: 'user') => unknown }): string => {
  const u = c.get('user') as { id: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return u.id;
};

function rangeOf(q: { from: string; to: string }): void {
  const a = Date.parse(`${q.from}T00:00:00Z`);
  const b = Date.parse(`${q.to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a > b || (b - a) / DAY_MS > MAX_RANGE_DAYS) {
    throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
  }
}

export function mountAdminAnnouncements(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AdminAnnouncementsService,
): void {
  const base = '/api/v1/admin/announcements';
  const write: RouteMeta = { ...ADMIN_READ, permission: 'platform:maintenance', stepUp: true };
  const writeJson: RouteMeta = { ...write, body: 'json' };

  const idOf = (c: { req: { param: (k: string) => string } }): string => {
    const id = c.req.param('announcementId');
    if (!UUID_RE.test(id)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    return id;
  };

  registry.add('get', base, ADMIN_READ);
  app.get(base, async (c) =>
    send(
      c,
      AdminAnnouncementListResponse,
      await svc.list(actorOf(c), queryOf(c, ListAnnouncementsQuery)),
    ),
  );

  registry.add('post', base, writeJson);
  app.post(base, async (c) => {
    const input = await jsonBody(c, CreateAnnouncementInput);
    return send(c, AnnouncementIdResult, await svc.publish(actorOf(c), input), 201);
  });

  registry.add('patch', `${base}/{announcementId}`, writeJson);
  app.patch(`${base}/:announcementId`, async (c) => {
    const id = idOf(c);
    const input = await jsonBody(c, UpdateAnnouncementInput);
    return send(c, AnnouncementIdResult, await svc.update(actorOf(c), id, input));
  });

  registry.add('post', `${base}/{announcementId}/withdraw`, writeJson);
  app.post(`${base}/:announcementId/withdraw`, async (c) =>
    send(c, AnnouncementIdResult, await svc.withdraw(actorOf(c), idOf(c))),
  );

  registry.add('get', '/api/v1/admin/notifications/summary', ADMIN_READ);
  app.get('/api/v1/admin/notifications/summary', async (c) => {
    const q = queryOf(c, NotificationSummaryQuery);
    rangeOf(q);
    return send(
      c,
      AdminNotificationSummaryResponse,
      await svc.notificationSummary(actorOf(c), q.from, q.to),
    );
  });
}
