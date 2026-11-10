// @tk TK-04 TK-05 TK-07
// Yönetim "Yapay zekâ" modülü (KK-P27c-ai): katalog/istem/kullanım okuma, model etkin/pasif yazma.
//  KK-P27c-ai-1  yetki: anonim 401, support 403, passkey penceresi geçince yazma 403 AUTH_STEP_UP_REQUIRED
//  KK-P27c-ai-2  katalog: sağlayıcı/model/veri sınıfı salt okur; sır ve model kimliği sızmaz
//  KK-P27c-ai-3  istemler: sürüm özeti + salt okur metin; düzenleme ucu yok
//  KK-P27c-ai-4  yazma: etkin/pasif + denetim kaydı; pasif sağlayıcı/son etkin model kuralı
//  KK-P27c-ai-5  veri sınıfı kapısı bu uçlarla gevşetilemez
// P27a yönetim kimliği (gerçek PostgreSQL + Valkey + Better Auth 1.7.7; ayrı `adminAuth` örneği).
//  KK-P27a-2  passkey-yalnız: parola/TOTP yolları 404; kayıt belirteci tek kullanımlık
//  KK-P27a-3  kayıt oturumu platformGate'ten geçmez; kayıttan sonra passkey ile giriş (mfa=passkey)
//  KK-P27a-4  çerez adı `__Host-eda-admin.`; uygulama çerezi yönetimde, yönetim çerezi uygulamada geçmez
//  KK-P27a-5  `platform_role=user` yönetim oturumu açamaz; yasaklı personel oturumu reddedilir
//  KK-P27a-6  son passkey silinemez; rol yalnız CLI ile verilir (HTTP rol ucu yok)
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAiConfigService } from '../../src/admin/ai-config-service.ts';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createAdminService } from '../../src/admin/service.ts';
import { createAdminSurface } from '../../src/admin-app.ts';
import { ADMIN_SESSION_COOKIE } from '../../src/auth/admin-auth.ts';
import { createAdminIdentity } from '../../src/auth/admin-identity.ts';
import { defaultAuthDb, valkeyReplayGuard, valkeySecondaryStorage } from '../../src/auth/index.ts';
import { closeAuthDbPool } from '../../src/auth/pool.ts';
import { createStaff } from '../../src/auth/staff.ts';
import { createValkeyClient } from '../../src/clients/valkey.ts';
import { RateLimiter } from '../../src/middleware/rate-limit.ts';
import { softAuthenticator } from './webauthn.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
    valkey: { url: string; username: string; passwordFile: string };
  }
}

const ADMIN_URL = 'https://admin.ornek.test';
const DOMAIN = 'ornek.test';
const KEY = randomUUID().slice(0, 8);
const logLines: string[] = [];
const CHALLENGE = '__Host-eda-admin.passkey_challenge';

let db: TestingDb;
let redis: Redis;
let admin: ReturnType<typeof createAdminSurface>;
let identity: ReturnType<typeof createAdminIdentity>;
let ipSeq = Math.floor(Math.random() * 60_000);
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.22`;
};

async function call(
  path: string,
  o: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { origin: ADMIN_URL, 'x-forwarded-for': freshIp() };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.cookie !== undefined) headers.cookie = o.cookie;
  return admin.request(`${ADMIN_URL}${path}`, {
    method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  });
}

const cookieOf = (res: Response, name: string): string | null => {
  const c = res.headers.getSetCookie().find((x) => x.startsWith(`${name}=`));
  return c === undefined ? null : (c.split(';')[0] ?? null);
};
const join2 = (...parts: (string | null)[]) => parts.filter((p) => p !== null).join('; ');

async function staff(tag: string, role: 'super_admin' | 'support' = 'super_admin') {
  const email = `${tag}.${KEY}@${DOMAIN}`;
  const r = await createStaff(
    {
      db: defaultAuthDb(),
      issueEnrollmentToken: identity.issueEnrollmentToken,
      revokeAllSessions: identity.revokeAllSessions,
      adminUrl: ADMIN_URL,
    },
    { email, name: `Örnek ${tag}`, role },
  );
  const token = r.enrollmentUrl.split('#kayit=')[1] ?? '';
  const uid = (await db.auth.userIdByEmail(email)) ?? '';
  return { email, token, uid };
}

/** Kayıt belirteciyle passkey kaydı; yazılım doğrulayıcıyı ve kayıt sonrası durumu döndürür. */
async function enroll(token: string) {
  const auth = softAuthenticator(DOMAIN, ADMIN_URL);
  const start = await call('/api/auth/staff/enroll', { body: { token } });
  if (start.status !== 200)
    throw new Error(
      `enroll ${start.status} ${await start.text()} ${logLines.slice(-3).join('\n')}`,
    );
  const cookie = cookieOf(start, ADMIN_SESSION_COOKIE) ?? '';
  const opts = await call('/api/auth/passkey/generate-register-options', { cookie });
  expect(opts.status).toBe(200);
  const reg = await call('/api/auth/passkey/verify-registration', {
    body: { response: auth.register((await opts.json()) as { challenge: string }) },
    cookie: join2(cookie, cookieOf(opts, CHALLENGE)),
  });
  return { auth, enrollCookie: cookie, reg };
}

async function login(auth: ReturnType<typeof softAuthenticator>, counter?: number) {
  const o = await call('/api/auth/passkey/generate-authenticate-options');
  return call('/api/auth/passkey/verify-authentication', {
    body: {
      response: auth.authenticate(
        (await o.json()) as { challenge: string },
        counter === undefined ? {} : { counter },
      ),
    },
    cookie: cookieOf(o, CHALLENGE) ?? '',
  });
}

beforeAll(async () => {
  const pg = inject('pg');
  const v = inject('valkey');
  db = createTestingDb(pg);
  redis = createValkeyClient(v, 'eda-admin-it');
  await redis.connect();
  const logger = createLogger({
    service: 'eda-admin-it',
    level: 'debug',
    destination: { write: (l) => logLines.push(l) },
  });
  const { withNoTenant, withTenant, withUserScope } = await import('@eda/db');
  identity = createAdminIdentity({
    baseURL: ADMIN_URL,
    adminUrl: ADMIN_URL,
    secret: `test-${randomUUID()}-${randomUUID()}`,
    passkeyRpId: DOMAIN,
    db: defaultAuthDb(),
    storage: valkeySecondaryStorage(redis),
    rate: new RateLimiter({ redis, hmacKey: Buffer.from(randomUUID()), now: () => Date.now() }),
    replay: valkeyReplayGuard(redis),
    appDb: { withTenant, withUserScope, withNoTenant },
    logger,
  });
  const state = { draining: false };
  admin = createAdminSurface(
    { surface: 'admin', logger, state, maintenanceMode: () => false, jsonBodyMaxBytes: 65_536 },
    {
      identity,
      adminUrl: ADMIN_URL,
      rate: new RateLimiter({
        redis,
        hmacKey: Buffer.from(randomUUID()),
        now: () => Date.now(),
      }),
      environment: 'test',
      maintenanceMode: () => false,
      service: createAdminService({
        db: adminDbFromEnv(),
        enqueueEmailSend: async () => undefined,
      }),
      aiConfig: createAiConfigService({
        db: adminDbFromEnv(),
        secretConfigured: (ref) => ref === 'deepseek_api_key',
      }),
    },
  );
});

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

async function loggedIn(tag: string, role: 'super_admin' | 'support' = 'super_admin') {
  const s = await staff(tag, role);
  const { auth } = await enroll(s.token);
  const ok = await login(auth);
  expect(ok.status).toBe(200);
  return { ...s, cookie: cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '' };
}

const PROV_ON = `test-ai-on-${KEY}`;
const PROV_OFF = `test-ai-off-${KEY}`;
const ids: { on1: string; on2: string; off1: string } = { on1: '', on2: '', off1: '' };

async function insertProvider(id: string, enabled: boolean) {
  await db.ownerQuery(
    `INSERT INTO app.ai_providers (id, kind, display_name, region, transfer_basis, allowed_data_classes, enabled, priority)
     VALUES ($1, 'deepseek', $2, 'CN', 'none', '{public}', $3, 5)`,
    [id, `Test ${id}`, enabled],
  );
}
async function insertModel(providerId: string, modelId: string, enabled: boolean) {
  const r = await db.ownerQuery<{ id: string }>(
    `INSERT INTO app.ai_models (alias, provider_id, model_id, label, context_budget, max_output_tokens,
       thinking, capabilities, priority, enabled)
     VALUES ('edai-flash', $1, $2, $3, 64000, 16000, 'off', '{"tools":true,"strictTools":false}'::jsonb, 50, $4)
     RETURNING id`,
    [providerId, modelId, 'Test modeli', enabled],
  );
  return r[0]?.id ?? '';
}

async function setStepUpOld(uid: string) {
  const ctx = await identity.auth.$context;
  for (const sess of await ctx.internalAdapter.listSessions(uid)) {
    await ctx.internalAdapter.updateSession(sess.token, {
      stepUpAt: new Date(Date.now() - 2 * 3_600_000),
    } as never);
  }
}

const put = (cookie: string, id: string, enabled: boolean) =>
  call(`/api/v1/admin/ai/models/${id}/enabled`, { method: 'PUT', body: { enabled }, cookie });

describe('KK-P27c-ai-1: yetki', () => {
  it('anonim 401; support 403; yazma step-up penceresi geçince 403 AUTH_STEP_UP_REQUIRED', async () => {
    for (const p of ['catalog', 'usage', 'prompts', 'prompts/chat.core']) {
      expect((await call(`/api/v1/admin/ai/${p}`)).status, p).toBe(401);
    }
    const sup = await loggedIn('ai-destek', 'support');
    for (const p of ['catalog', 'usage', 'prompts', 'prompts/chat.core']) {
      const r = await call(`/api/v1/admin/ai/${p}`, { cookie: sup.cookie });
      expect(r.status, p).toBe(403);
    }
    expect((await put(sup.cookie, randomUUID(), false)).status).toBe(403);

    const a = await loggedIn('ai-stepup');
    await setStepUpOld(a.uid);
    const w = await put(a.cookie, randomUUID(), false);
    expect(w.status).toBe(403);
    expect(((await w.json()) as { error: { code: string } }).error.code).toBe(
      'AUTH_STEP_UP_REQUIRED',
    );
    // Okuma uçları step-up istemez.
    const ok = await call('/api/v1/admin/ai/catalog', { cookie: a.cookie });
    expect(ok.status, logLines.slice(-4).join('\n')).toBe(200);
  });
});

describe('KK-P27c-ai-2: katalog ve kullanım (salt okur, sızıntısız)', () => {
  beforeAll(async () => {
    await insertProvider(PROV_ON, true);
    await insertProvider(PROV_OFF, false);
    ids.on1 = await insertModel(PROV_ON, `m1-${KEY}`, true);
    ids.on2 = await insertModel(PROV_ON, `m2-${KEY}`, true);
    ids.off1 = await insertModel(PROV_OFF, `m3-${KEY}`, false);
  });
  afterAll(async () => {
    await db.ownerQuery('DELETE FROM app.ai_models WHERE provider_id = ANY($1)', [
      [PROV_ON, PROV_OFF],
    ]);
    await db.ownerQuery('DELETE FROM app.ai_providers WHERE id = ANY($1)', [[PROV_ON, PROV_OFF]]);
  });

  it('sağlayıcı, model ve veri sınıfı izinleri döner; model kimliği ve sır sızmaz', async () => {
    const a = await loggedIn('ai-katalog');
    const r = await call('/api/v1/admin/ai/catalog', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const text = await r.text();
    const j = JSON.parse(text) as {
      providers: { id: string; allowedDataClasses: string[]; enabled: boolean }[];
      models: { id: string; providerId: string; label: string; enabled: boolean }[];
      notInDb: { providers: string[] };
    };
    const on = j.providers.find((p) => p.id === PROV_ON);
    expect(on?.allowedDataClasses).toEqual(['public']);
    expect(j.providers.find((p) => p.id === PROV_OFF)?.enabled).toBe(false);
    expect(j.models.filter((m) => m.providerId === PROV_ON)).toHaveLength(2);
    expect(j.models.find((m) => m.id === ids.off1)?.enabled).toBe(false);
    // Sağlayıcı model kimliği ve anahtar yolu/değeri yanıtta yok.
    expect(text).not.toContain(`m1-${KEY}`);
    expect(text).not.toMatch(/secretRef|secret_ref|apiKey|api_key|modelId/);
    expect(Array.isArray(j.notInDb.providers)).toBe(true);
  });

  it('son 7 gün özeti toplulaştırılmıştır (çağrı/hata oranı), kişi veya içerik yok', async () => {
    const a = await loggedIn('ai-kullanim');
    const r = await call('/api/v1/admin/ai/usage', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      windowDays: number;
      items: { alias: string; calls: number; errors: number; errorRate: number }[];
    };
    expect(j.windowDays).toBe(7);
    for (const i of j.items) {
      expect(i.errorRate).toBeGreaterThanOrEqual(0);
      expect(i.errorRate).toBeLessThanOrEqual(1);
      expect(i.errors).toBeLessThanOrEqual(i.calls);
    }
    expect(Object.keys(j.items[0] ?? {}).sort()).toEqual(
      ['alias', 'avgLatencyMs', 'calls', 'errorRate', 'errors', 'providerId'].sort(),
    );
  });
});

describe('KK-P27c-ai-3: istemler salt okur', () => {
  it('sürüm listesi ad/sürüm/karakter/özet taşır; metin ayrı uçta; düzenleme ucu yok', async () => {
    const a = await loggedIn('ai-istem');
    const list = await call('/api/v1/admin/ai/prompts', { cookie: a.cookie });
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      items: { key: string; version: number; chars: number; sha256: string }[];
    };
    expect(body.items.length).toBeGreaterThanOrEqual(3);
    const core = body.items.find((p) => p.key === 'chat.core');
    expect(core?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(body)).not.toContain('"text"');
    const one = await call('/api/v1/admin/ai/prompts/chat.core', { cookie: a.cookie });
    expect(one.status).toBe(200);
    const t = (await one.json()) as { text: string; version: number };
    expect(t.text.length).toBe(core?.chars);
    expect((await call('/api/v1/admin/ai/prompts/yok.istem', { cookie: a.cookie })).status).toBe(
      404,
    );
    for (const method of ['PUT', 'POST', 'PATCH', 'DELETE']) {
      const r = await call('/api/v1/admin/ai/prompts/chat.core', {
        method,
        body: { text: 'x' },
        cookie: a.cookie,
      });
      expect(r.status, method).toBeGreaterThanOrEqual(404);
    }
  });
});

describe('KK-P27c-ai-4/5: etkin/pasif yazma ve denetim', () => {
  const auditRows = (modelId: string) =>
    db.jobsQuery<{ action: string; metadata: Record<string, unknown>; actor_id: string }>(
      `SELECT action, metadata, actor_id FROM app.audit_log
        WHERE target_type = 'ai_model' AND target_id = $1 ORDER BY created_at`,
      [modelId],
    );

  beforeAll(async () => {
    // Bir önceki describe afterAll'ı sildi; yeniden kur.
    await insertProvider(PROV_ON, true);
    await insertProvider(PROV_OFF, false);
    ids.on1 = await insertModel(PROV_ON, `m1-${KEY}`, true);
    ids.on2 = await insertModel(PROV_ON, `m2-${KEY}`, true);
    ids.off1 = await insertModel(PROV_OFF, `m3-${KEY}`, false);
  });
  afterAll(async () => {
    await db.ownerQuery('DELETE FROM app.ai_models WHERE provider_id = ANY($1)', [
      [PROV_ON, PROV_OFF],
    ]);
    await db.ownerQuery('DELETE FROM app.ai_providers WHERE id = ANY($1)', [[PROV_ON, PROV_OFF]]);
  });

  it('pasifleştirme ve geri açma denetim kaydı yazar; aynı değer değişmez ve kayıt yazmaz', async () => {
    const a = await loggedIn('ai-yazma');
    const off = await put(a.cookie, ids.on2, false);
    expect(off.status).toBe(200);
    expect(await off.json()).toEqual({ id: ids.on2, enabled: false, changed: true });
    const rows = await auditRows(ids.on2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.action).toBe('ai_model.changed');
    expect(rows[0]?.actor_id).toBe(a.uid);
    expect(rows[0]?.metadata).toMatchObject({ enabled: false, previous: true });
    // İçerik yok: yalnız takma ad, sağlayıcı kimliği ve durum.
    expect(Object.keys(rows[0]?.metadata ?? {}).sort()).toEqual(
      ['alias', 'enabled', 'previous', 'providerId'].sort(),
    );
    const same = await put(a.cookie, ids.on2, false);
    expect(await same.json()).toEqual({ id: ids.on2, enabled: false, changed: false });
    expect(await auditRows(ids.on2)).toHaveLength(1);
    const on = await put(a.cookie, ids.on2, true);
    expect(((await on.json()) as { changed: boolean }).changed).toBe(true);
    expect(await auditRows(ids.on2)).toHaveLength(2);
  });

  it('pasif sağlayıcının modeli etkinleştirilemez (409)', async () => {
    const a = await loggedIn('ai-pasif-saglayici');
    const r = await put(a.cookie, ids.off1, true);
    expect(r.status).toBe(409);
    expect(await auditRows(ids.off1)).toHaveLength(0);
  });

  it('takma adın son etkin modeli pasifleştirilemez; başka etkin model varsa serbest', async () => {
    const a = await loggedIn('ai-son-model');
    const others = await db.ownerQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM app.ai_models m JOIN app.ai_providers p ON p.id = m.provider_id
        WHERE m.alias = 'edai-flash' AND m.enabled AND p.enabled AND m.provider_id <> $1`,
      [PROV_ON],
    );
    expect((await put(a.cookie, ids.on1, false)).status).toBe(200);
    const last = await put(a.cookie, ids.on2, false);
    expect(last.status).toBe(Number(others[0]?.n ?? 0) > 0 ? 200 : 409);
    await put(a.cookie, ids.on1, true);
    await put(a.cookie, ids.on2, true);
  });

  it('geçersiz kimlik 404, bilinmeyen model 404, gövde şeması katı (422)', async () => {
    const a = await loggedIn('ai-gecersiz');
    expect((await put(a.cookie, 'degil-uuid', true)).status).toBe(404);
    expect((await put(a.cookie, randomUUID(), true)).status).toBe(404);
    const extra = await call(`/api/v1/admin/ai/models/${ids.on1}/enabled`, {
      method: 'PUT',
      body: { enabled: true, allowedDataClasses: ['case'] },
      cookie: a.cookie,
    });
    expect(extra.status).toBe(422);
  });

  it('veri sınıfı izinleri bu uçlarla değişmez (KK-5: deepseek yalnız public)', async () => {
    const a = await loggedIn('ai-sinif');
    await put(a.cookie, ids.on1, false);
    await put(a.cookie, ids.on1, true);
    const rows = await db.ownerQuery<{ allowed_data_classes: string[] }>(
      'SELECT allowed_data_classes FROM app.ai_providers WHERE id = $1',
      [PROV_ON],
    );
    expect(rows[0]?.allowed_data_classes).toEqual(['public']);
    // Sağlayıcı veya sınıf yazan bir rota yok.
    for (const [method, path] of [
      ['PUT', `/api/v1/admin/ai/providers/${PROV_ON}`],
      ['PUT', `/api/v1/admin/ai/providers/${PROV_ON}/classes`],
      ['PATCH', '/api/v1/admin/ai/catalog'],
    ] as const) {
      const r = await call(path, {
        method,
        body: { allowedDataClasses: ['case'] },
        cookie: a.cookie,
      });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
  });
});
