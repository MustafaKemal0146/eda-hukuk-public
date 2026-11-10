// `/api/v1/admin/ai/keys*`: süper yönetici büro/baro ya da kullanıcıya Anthropic API anahtarı atar
// veya siler; ayrıca platform ortak anahtarını girer/değiştirir/siler, ona ad verir, düşüşü açıp kapatır ve
// platform geneli günlük sınırları ve harcama tavanını ayarlar (`.../platform/key|key/label|fallback|limits|cap`). Değiştiren her uç YALNIZ `super_admin` içindir
// (sunucuda yeniden doğrulanır), `platform:system_settings_write` izni ve step-up ister, aktör başına hız
// sınırı uygular; denetim satırı veritabanı işleminde yazılır. Durum listeleri kullanıcı e-postası taşıdığından
// onlar da step-up ister; arama metni URL'de taşınmaz (`POST .../search`). Anahtar YALNIZ atama isteğinde gider;
// hiçbir yanıt anahtarı taşımaz (tanımlı/yok, son 4 karakter, zaman). Yanıtlar `no-store`.

import {
  AdminAiKeyListQuery,
  AdminAiKeyOrgItemDto,
  AdminAiKeyOrgListResponse,
  AdminAiKeySearchInput,
  AdminAiKeyUserItemDto,
  AdminAiKeyUserListResponse,
  AdminAiPlatformCapInput,
  AdminAiPlatformFallbackInput,
  AdminAiPlatformKeyDto,
  AdminAiPlatformKeyInput,
  AdminAiPlatformLabelInput,
  AdminAiPlatformLimitsInput,
} from '@eda/contracts/api/admin-ai-keys';
import { AiApiKeyInput } from '@eda/contracts/api/ai-keys';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import { jsonBody, queryOf, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { AdminAiKeysService } from '../ai-keys-service.ts';
import { ADMIN_READ } from './me.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MINUTE = 60_000;

const actorOf = (c: { get: (k: 'user') => unknown }): { id: string; role: string } => {
  const u = c.get('user') as { id: string; platformRole: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return { id: u.id, role: u.platformRole };
};

function idOf(c: { req: { param: (k: string) => string } }, name: string): string {
  const id = c.req.param(name);
  if (!UUID_RE.test(id)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
  return id.toLowerCase();
}

export function mountAdminAiKeys(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AdminAiKeysService,
  rate: Pick<RateLimiter, 'enforce'>,
): void {
  const base = '/api/v1/admin/ai/keys';
  /** Kart toplulaştırılmıştır (kişi yok): step-up gerekmez. */
  const card: RouteMeta = { ...ADMIN_READ, permission: 'platform:system_settings_read' };
  /** Durum listeleri e-posta taşır ve yazma izniyle aynı düzeydedir (step-up). */
  const read: RouteMeta = {
    ...ADMIN_READ,
    permission: 'platform:system_settings_write',
    stepUp: true,
  };
  const readBody: RouteMeta = { ...read, body: 'json' };
  const write: RouteMeta = { ...read, body: 'json' };
  const remove: RouteMeta = { ...read, body: 'none' };

  /** Değiştirici uçlar yalnız `super_admin`; hız sınırı aktör başınadır. */
  async function writer(c: { get: (k: 'user') => unknown }): Promise<string> {
    const a = actorOf(c);
    if (a.role !== 'super_admin') {
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'permission_missing' });
    }
    await rate.enforce(
      'api-user',
      `admin-ai-key-write:${a.id}`,
      CONFIG_DEFAULTS['rateLimit.adminUserWritePerMin'],
      MINUTE,
    );
    return a.id;
  }

  registry.add('get', `${base}/platform`, card);
  app.get(`${base}/platform`, async (c) =>
    send(c, AdminAiPlatformKeyDto, await svc.platformCard(actorOf(c).id)),
  );

  registry.add('put', `${base}/platform/key`, write);
  app.put(`${base}/platform/key`, async (c) => {
    const actor = await writer(c);
    const input = await jsonBody(c, AdminAiPlatformKeyInput);
    return send(
      c,
      AdminAiPlatformKeyDto,
      await svc.setPlatformKey(actor, input.apiKey, input.label),
    );
  });

  registry.add('put', `${base}/platform/key/label`, write);
  app.put(`${base}/platform/key/label`, async (c) => {
    const actor = await writer(c);
    const input = await jsonBody(c, AdminAiPlatformLabelInput);
    return send(c, AdminAiPlatformKeyDto, await svc.renamePlatformKey(actor, input.label));
  });

  registry.add('delete', `${base}/platform/key`, remove);
  app.delete(`${base}/platform/key`, async (c) => {
    const actor = await writer(c);
    return send(c, AdminAiPlatformKeyDto, await svc.removePlatformKey(actor));
  });

  registry.add('put', `${base}/platform/fallback`, write);
  app.put(`${base}/platform/fallback`, async (c) => {
    const actor = await writer(c);
    const input = await jsonBody(c, AdminAiPlatformFallbackInput);
    return send(c, AdminAiPlatformKeyDto, await svc.setPlatformFallback(actor, input.enabled));
  });

  registry.add('put', `${base}/platform/limits`, write);
  app.put(`${base}/platform/limits`, async (c) => {
    const actor = await writer(c);
    const input = await jsonBody(c, AdminAiPlatformLimitsInput);
    return send(c, AdminAiPlatformKeyDto, await svc.setPlatformLimits(actor, input));
  });

  registry.add('put', `${base}/platform/cap`, write);
  app.put(`${base}/platform/cap`, async (c) => {
    const actor = await writer(c);
    const input = await jsonBody(c, AdminAiPlatformCapInput);
    return send(c, AdminAiPlatformKeyDto, await svc.setPlatformCap(actor, input));
  });

  registry.add('get', `${base}/orgs`, read);
  app.get(`${base}/orgs`, async (c) =>
    send(
      c,
      AdminAiKeyOrgListResponse,
      await svc.listOrgs(actorOf(c).id, null, queryOf(c, AdminAiKeyListQuery).limit),
    ),
  );

  registry.add('post', `${base}/orgs/search`, readBody);
  app.post(`${base}/orgs/search`, async (c) => {
    const input = await jsonBody(c, AdminAiKeySearchInput);
    return send(
      c,
      AdminAiKeyOrgListResponse,
      await svc.listOrgs(actorOf(c).id, input.query, input.limit),
    );
  });

  registry.add('put', `${base}/orgs/{orgId}`, write);
  app.put(`${base}/orgs/:orgId`, async (c) => {
    const actor = await writer(c);
    const orgId = idOf(c, 'orgId');
    const input = await jsonBody(c, AiApiKeyInput);
    return send(c, AdminAiKeyOrgItemDto, await svc.setOrgKey(actor, orgId, input.apiKey));
  });

  registry.add('delete', `${base}/orgs/{orgId}`, remove);
  app.delete(`${base}/orgs/:orgId`, async (c) => {
    const actor = await writer(c);
    return send(c, AdminAiKeyOrgItemDto, await svc.removeOrgKey(actor, idOf(c, 'orgId')));
  });

  registry.add('get', `${base}/users`, read);
  app.get(`${base}/users`, async (c) =>
    send(
      c,
      AdminAiKeyUserListResponse,
      await svc.listUsers(actorOf(c).id, null, queryOf(c, AdminAiKeyListQuery).limit),
    ),
  );

  registry.add('post', `${base}/users/search`, readBody);
  app.post(`${base}/users/search`, async (c) => {
    const input = await jsonBody(c, AdminAiKeySearchInput);
    return send(
      c,
      AdminAiKeyUserListResponse,
      await svc.listUsers(actorOf(c).id, input.query, input.limit),
    );
  });

  registry.add('put', `${base}/users/{userId}`, write);
  app.put(`${base}/users/:userId`, async (c) => {
    const actor = await writer(c);
    const userId = idOf(c, 'userId');
    const input = await jsonBody(c, AiApiKeyInput);
    return send(c, AdminAiKeyUserItemDto, await svc.setUserKey(actor, userId, input.apiKey));
  });

  registry.add('delete', `${base}/users/{userId}`, remove);
  app.delete(`${base}/users/:userId`, async (c) => {
    const actor = await writer(c);
    return send(c, AdminAiKeyUserItemDto, await svc.removeUserKey(actor, idOf(c, 'userId')));
  });
}
