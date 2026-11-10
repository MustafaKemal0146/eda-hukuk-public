// `/api/v1/notifications*` (045 §6; 002 §15): uygulama içi bildirim kutusu. Statik
// `/notifications/preferences` ve `/read-all` yolları parametreli `/:id/read`'den ÖNCE kaydedilir.
import {
  ListNotificationsQuery,
  NotificationListResponse,
  ReadAllResponse,
} from '@eda/contracts/api/notifications';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { NotificationInboxService } from '../services/notifications/inbox.ts';
import { queryOf, send, tenantActor } from './helpers.ts';

const READ: RouteMeta = {
  permission: 'self',
  tenant: 'required',
  allowVerification: 'verified',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

export function mountNotifications(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: NotificationInboxService,
) {
  const base = '/api/v1/notifications';

  registry.add('get', base, READ);
  app.get(base, async (c) =>
    send(
      c,
      NotificationListResponse,
      await svc.list(tenantActor(c), queryOf(c, ListNotificationsQuery)),
    ),
  );

  registry.add('post', `${base}/read-all`, READ);
  app.post(`${base}/read-all`, async (c) =>
    send(c, ReadAllResponse, await svc.readAll(tenantActor(c))),
  );

  registry.add('post', `${base}/{notificationId}/read`, READ);
  app.post(`${base}/:notificationId/read`, async (c) => {
    await svc.read(tenantActor(c), c.req.param('notificationId'));
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });
}
