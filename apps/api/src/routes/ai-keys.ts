// `/api/v1/ai-keys*` uçları (#54 BYOK). Büro/baro anahtarını yalnız `org:ai_policy_write` (sahip ve
// yönetici; step-up) değiştirir; kullanıcı kendi anahtarını ve kaynak seçimini yönetir. Yanıtlar anahtarı
// ASLA taşımaz (yalnız son 4 karakter ve durum) ve `Cache-Control: no-store`. Anahtar günlüğe yazılmaz.
import { AiApiKeyInput, AiKeySourceInput, AiKeysStatusDto } from '@eda/contracts/api/ai-keys';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { AiKeysService } from '../services/ai-keys/ai-keys.ts';
import { jsonBody, send, tenantActor } from './helpers.ts';

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
const WRITE: RouteMeta = { ...READ, body: 'json' };
/** Büro anahtarı: sahip/yönetici ve yeniden doğrulama (`org:ai_policy_write` step-up ister). */
const ORG_READ: RouteMeta = { ...READ, permission: 'org:ai_policy_write', stepUp: true };
const ORG_WRITE: RouteMeta = { ...ORG_READ, body: 'json' };

export function mountAiKeys(app: Hono<SurfaceEnv>, registry: RouteRegistry, svc: AiKeysService) {
  const base = '/api/v1/ai-keys';

  registry.add('get', base, READ);
  app.get(base, async (c) => send(c, AiKeysStatusDto, await svc.status(tenantActor(c))));

  registry.add('put', `${base}/org`, ORG_WRITE);
  app.put(`${base}/org`, async (c) => {
    const input = await jsonBody(c, AiApiKeyInput);
    return send(c, AiKeysStatusDto, await svc.setOrgKey(tenantActor(c), input.apiKey));
  });

  registry.add('delete', `${base}/org`, ORG_READ);
  app.delete(`${base}/org`, async (c) =>
    send(c, AiKeysStatusDto, await svc.removeOrgKey(tenantActor(c))),
  );

  registry.add('put', `${base}/own`, WRITE);
  app.put(`${base}/own`, async (c) => {
    const input = await jsonBody(c, AiApiKeyInput);
    return send(c, AiKeysStatusDto, await svc.setOwnKey(tenantActor(c), input.apiKey));
  });

  registry.add('delete', `${base}/own`, READ);
  app.delete(`${base}/own`, async (c) =>
    send(c, AiKeysStatusDto, await svc.removeOwnKey(tenantActor(c))),
  );

  registry.add('put', `${base}/source`, WRITE);
  app.put(`${base}/source`, async (c) => {
    const input = await jsonBody(c, AiKeySourceInput);
    return send(c, AiKeysStatusDto, await svc.setSource(tenantActor(c), input.source));
  });
}
