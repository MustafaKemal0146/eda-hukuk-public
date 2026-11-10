// `/api/v1/admin/users*` (053-ekranlar/11 §3.4): kullanıcı listesi ve araması, ayrıntı, hesap askısı,
// oturum sonlandırma ve kullanıcıya özel limitler. Okuma personele (`support`, `super_admin`) açıktır;
// her değiştirici uç YALNIZ `super_admin` içindir, `stepUp: true` ister, yazma hız sınırı uygular ve
// denetim satırını veritabanı işleminde yazar. Arama metni URL'de taşınmaz (`POST /users/search`).
import {
  AdminUserDetailDto,
  AdminUserLimitsInput,
  AdminUserListQuery,
  AdminUserListResponse,
  AdminUserSearchInput,
  AdminUserSessionsRevokeResult,
  AdminUserSuspendInput,
  AdminUserSuspendResult,
} from '@eda/contracts/api/admin-users';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import { jsonBody, queryOf, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { AdminUsersService } from '../users-service.ts';
import { ADMIN_READ } from './me.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE = 60_000;

const actorOf = (c: { get: (k: 'user') => unknown }): { id: string; role: string } => {
  const u = c.get('user') as { id: string; platformRole: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return { id: u.id, role: u.platformRole };
};

function userIdOf(c: { req: { param: (k: string) => string } }): string {
  const id = c.req.param('userId');
  if (!UUID_RE.test(id)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
  return id.toLowerCase();
}

export function mountAdminUsers(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AdminUsersService,
  rate: Pick<RateLimiter, 'enforce'>,
): void {
  const base = '/api/v1/admin/users';
  // `platform:user_suspend` izin tablosunda step-up ister (okuma dahil; kişi bazlı e-posta görünür).
  const read: RouteMeta = { ...ADMIN_READ, permission: 'platform:user_suspend', stepUp: true };
  const readBody: RouteMeta = { ...read, body: 'json' };
  const suspend: RouteMeta = { ...read, body: 'json' };
  // Oturum sonlandırma da step-up ister; `platform:session_revoke` step-up istemediğinden (census:
  // izin tablosu ile meta eşit olmalı) hesap işlemi izni `platform:user_suspend` kullanılır.
  const revoke: RouteMeta = { ...read, body: 'none' };
  const limits: RouteMeta = {
    ...read,
    permission: 'platform:system_settings_write',
    body: 'json',
  };
  const limitsReset: RouteMeta = { ...limits, body: 'none' };

  /** Değiştirici uçlar yalnız `super_admin`; `support` salt-okurdur. Hız sınırı aktör başınadır. */
  async function writer(c: { get: (k: 'user') => unknown }): Promise<string> {
    const a = actorOf(c);
    if (a.role !== 'super_admin')
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'permission_missing' });
    await rate.enforce(
      'api-user',
      `admin-user-write:${a.id}`,
      CONFIG_DEFAULTS['rateLimit.adminUserWritePerMin'],
      MINUTE,
    );
    return a.id;
  }

  registry.add('get', base, read);
  app.get(base, async (c) =>
    send(c, AdminUserListResponse, await svc.list(actorOf(c).id, queryOf(c, AdminUserListQuery))),
  );

  registry.add('post', `${base}/search`, readBody);
  app.post(`${base}/search`, async (c) =>
    send(
      c,
      AdminUserListResponse,
      await svc.search(actorOf(c).id, await jsonBody(c, AdminUserSearchInput)),
    ),
  );

  registry.add('get', `${base}/{userId}`, read);
  app.get(`${base}/:userId`, async (c) =>
    send(c, AdminUserDetailDto, await svc.detail(actorOf(c).id, userIdOf(c))),
  );

  registry.add('post', `${base}/{userId}/suspend`, suspend);
  app.post(`${base}/:userId/suspend`, async (c) => {
    const actor = await writer(c);
    const userId = userIdOf(c);
    const input = await jsonBody(c, AdminUserSuspendInput);
    return send(c, AdminUserSuspendResult, await svc.setSuspended(actor, userId, input));
  });

  registry.add('post', `${base}/{userId}/sessions/revoke`, revoke);
  app.post(`${base}/:userId/sessions/revoke`, async (c) => {
    const actor = await writer(c);
    return send(c, AdminUserSessionsRevokeResult, await svc.revokeSessions(actor, userIdOf(c)));
  });

  registry.add('post', `${base}/{userId}/limits`, limits);
  app.post(`${base}/:userId/limits`, async (c) => {
    const actor = await writer(c);
    const userId = userIdOf(c);
    const input = await jsonBody(c, AdminUserLimitsInput);
    return send(c, AdminUserDetailDto, await svc.setLimits(actor, userId, input));
  });

  registry.add('post', `${base}/{userId}/limits/reset`, limitsReset);
  app.post(`${base}/:userId/limits/reset`, async (c) => {
    const actor = await writer(c);
    return send(
      c,
      AdminUserDetailDto,
      await svc.setLimits(actor, userIdOf(c), {
        chatTurnsPerDay: null,
        chatTurnsPerMonth: null,
        tokensPerDay: null,
        tokensPerMonth: null,
      }),
    );
  });
}
