// `/api/v1/notifications/preferences` (045 §5.4; 002 §15). Kullanıcı düzeyi tercih: büro bağlamı
// gerekmez (`tenant: optional`), e-postası doğrulanmış kullanıcı. Yanıtlar `Cache-Control: no-store`.
import {
  NotificationPreferencesResponse,
  PutNotificationPreferencesInput,
} from '@eda/contracts/api/notification-preferences';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { NotificationPreferencesService } from '../services/notifications/preferences.ts';
import { jsonBody, send } from './helpers.ts';

const READ: RouteMeta = {
  permission: 'self',
  tenant: 'optional',
  allowVerification: 'verified',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};
const WRITE: RouteMeta = { ...READ, body: 'json' };

export function mountNotificationPreferences(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: NotificationPreferencesService,
) {
  const path = '/api/v1/notifications/preferences';
  const actor = (c: { get: (k: 'user') => unknown }) => {
    const u = c.get('user') as { id: string } | undefined;
    if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
    return { userId: u.id };
  };

  registry.add('get', path, READ);
  app.get(path, async (c) => send(c, NotificationPreferencesResponse, await svc.get(actor(c))));

  registry.add('put', path, WRITE);
  app.put(path, async (c) => {
    const input = await jsonBody(c, PutNotificationPreferencesInput);
    return send(c, NotificationPreferencesResponse, await svc.put(actor(c), input));
  });
}
