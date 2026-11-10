// @tk TK-04 TK-05 TK-07
// Yönetim "Yapay zekâ anahtar ataması":
//  KK-ai-anahtar-1  yetki: anonim 401, support 403, step-up penceresi geçince 403, yazma hız sınırı
//  KK-ai-anahtar-2  büro/kullanıcı atama: resolve doğru anahtarı verir, başka büro etkilenmez, silme
//  KK-ai-anahtar-3  anahtar ve son 4 hane yanıtta (atama dışı), denetimde ve loglarda sızmaz
//  KK-ai-anahtar-4  platform kartı: bayrak, tanımlı/yok, son 24 saat toplamı
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decryptField, parseKekFile, wipe, wrapDek } from '@eda/crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAdminAiKeysService } from '../../src/admin/ai-keys-service.ts';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createPlatformSettingsLoader } from '../../src/admin/platform-settings-source.ts';
import { createAdminService } from '../../src/admin/service.ts';
import { createAdminUsersService } from '../../src/admin/users-service.ts';
import { createAdminSurface } from '../../src/admin-app.ts';
import { ADMIN_SESSION_COOKIE } from '../../src/auth/admin-auth.ts';
import { createAdminIdentity } from '../../src/auth/admin-identity.ts';
import { defaultAuthDb, valkeyReplayGuard, valkeySecondaryStorage } from '../../src/auth/index.ts';
import { closeAuthDbPool } from '../../src/auth/pool.ts';
import { createStaff } from '../../src/auth/staff.ts';
import { createValkeyClient } from '../../src/clients/valkey.ts';
import { type IdentitySetup, setupIdentity } from '../../src/identity.ts';
import { RateLimiter } from '../../src/middleware/rate-limit.ts';
import { createAiKeysService } from '../../src/services/ai-keys/ai-keys.ts';
import {
  derivePlatformKey,
  orgKeyContext,
  platformKeyContext,
} from '../../src/services/ai-keys/crypto.ts';
import { createPlatformKeyGate } from '../../src/services/ai-keys/platform-gate.ts';
import {
  createPlatformSettings,
  type PlatformSettingsProvider,
} from '../../src/services/ai-keys/platform-settings.ts';
import { softAuthenticator } from './webauthn.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
    valkey: { url: string; username: string; passwordFile: string };
  }
}

const APP_URL = 'https://app.ornek.test';
const ADMIN_URL = 'https://admin.ornek.test';
const DOMAIN = 'ornek.test';
const KEY = randomUUID().slice(0, 8);
const START = { modelAlias: 'edai-flash', conversationId: null, requestId: null } as const;
const CHALLENGE = '__Host-eda-admin.passkey_challenge';

let db: TestingDb;
let redis: Redis;
let queueRedis: Redis;
let setup: IdentitySetup;
let admin: ReturnType<typeof createAdminSurface>;
let identity: ReturnType<typeof createAdminIdentity>;
let kek: ReturnType<typeof parseKekFile>;
const verifyCalls: string[] = [];
const logLines: string[] = [];
const PLATFORM_KEY = `sk-ant-test-${'P'.repeat(30)}plat`;
/** Sunucu sır dosyası taklidi (DB anahtarı yokken yedek); testler değiştirebilir. */
let fileKey: string | null = PLATFORM_KEY;
let platformSettings: PlatformSettingsProvider;
const platformEvents: string[] = [];
const REJECTED = `sk-ant-test-${'R'.repeat(30)}rjct`;
const KEY_ORG = `sk-ant-test-${'O'.repeat(30)}org1`;
const KEY_USER = `sk-ant-test-${'U'.repeat(30)}usr1`;
const KEY_ORG2 = `sk-ant-test-${'Q'.repeat(30)}org2`;
let ipSeq = Math.floor(Math.random() * 60_000);
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.23`;
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

async function loggedIn(tag: string, role: 'super_admin' | 'support' = 'super_admin') {
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
  const auth = softAuthenticator(DOMAIN, ADMIN_URL);
  const start = await call('/api/auth/staff/enroll', { body: { token } });
  expect(start.status).toBe(200);
  const enrollCookie = cookieOf(start, ADMIN_SESSION_COOKIE) ?? '';
  const opts = await call('/api/auth/passkey/generate-register-options', { cookie: enrollCookie });
  const reg = await call('/api/auth/passkey/verify-registration', {
    body: { response: auth.register((await opts.json()) as { challenge: string }) },
    cookie: join2(enrollCookie, cookieOf(opts, CHALLENGE)),
  });
  expect(reg.status).toBe(200);
  const o = await call('/api/auth/passkey/generate-authenticate-options');
  const ok = await call('/api/auth/passkey/verify-authentication', {
    body: { response: auth.authenticate((await o.json()) as { challenge: string }) },
    cookie: cookieOf(o, CHALLENGE) ?? '',
  });
  expect(ok.status).toBe(200);
  return { email, uid, cookie: cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '' };
}

/** Oturum açabilen sıradan kullanıcı (doğrulanmış, bireysel büro üyesi). */
async function appUser(tag: string, status: 'verified' | 'pending_verification' = 'verified') {
  const email = `${tag}.${KEY}@${DOMAIN}`;
  const uid = await db.auth.insertUser({
    name: `Kullanıcı ${tag}`,
    email,
    emailVerified: true,
    verificationStatus: status,
  });
  const org = await db.auth.insertOrg(`Bireysel ${tag}`, 'individual');
  await db.auth.addMember(org, uid, 'owner');
  return { uid, email, org };
}

beforeAll(async () => {
  const pg = inject('pg');
  const v = inject('valkey');
  db = createTestingDb(pg);
  redis = createValkeyClient(v, 'eda-admin-users-it');
  await redis.connect();
  const logger = createLogger({
    service: 'eda-admin-users-it',
    level: 'debug',
    destination: { write: (m: string) => logLines.push(m) },
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
  const kekFile = readFileSync(join(pg.secretsDir, 'kek_master'), 'utf8');
  queueRedis = createValkeyClient(v, 'eda-admin-users-it-queue');
  await queueRedis.connect();
  kek = parseKekFile(kekFile);
  platformSettings = createPlatformSettings({
    envGate: true,
    load: createPlatformSettingsLoader(adminDbFromEnv()),
    kek: kek.kek,
    readFileKey: () => fileKey,
    now: () => Date.now(),
    onEvent: (e) => platformEvents.push(e),
  });
  setup = setupIdentity({
    edaEnv: 'test',
    appUrl: APP_URL,
    baseURL: APP_URL,
    secret: `test-${randomUUID()}-${randomUUID()}`,
    passkeyRpId: DOMAIN,
    kekFileContent: kekFile,
    hmacKey: Buffer.from(randomUUID()),
    redis,
    queueRedis,
    logger,
    rerankEnabled: false,
    maintenance: () => false,
    platformSettings,
  });
  admin = createAdminSurface(
    {
      surface: 'admin',
      logger,
      state: { draining: false },
      maintenanceMode: () => false,
      jsonBodyMaxBytes: 65_536,
    },
    {
      identity,
      adminUrl: ADMIN_URL,
      rate: new RateLimiter({ redis, hmacKey: Buffer.from(randomUUID()), now: () => Date.now() }),
      environment: 'test',
      maintenanceMode: () => false,
      service: createAdminService({
        db: adminDbFromEnv(),
        enqueueEmailSend: async () => undefined,
      }),
      usersService: createAdminUsersService({
        db: adminDbFromEnv(),
        revokeAllSessions: (userId) => identity.revokeUserSessions(userId),
      }),
      aiKeys: createAdminAiKeysService({
        db: adminDbFromEnv(),
        kek: { kek: kek.kek, kekVersion: kek.kekVersion },
        verify: async (k) => {
          verifyCalls.push(k.slice(-4));
          return k !== REJECTED;
        },
        platform: {
          envGateOpen: true,
          fileKeyConfigured: () => fileKey !== null,
          onChanged: () => platformSettings.invalidate(),
        },
        now: () => new Date(),
      }),
    },
  );
});

afterAll(async () => {
  await setup?.producer.close().catch(() => undefined);
  await queueRedis?.quit().catch(() => undefined);
  await redis?.quit().catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

/** Anahtarsız hizmet (platform düşüşü kapalı): yönetim atamasının gerçek etkisini ölçer. */
const plainKeys = () =>
  createAiKeysService({
    db: db.runner('eda_app'),
    kek: { kek: kek.kek, kekVersion: kek.kekVersion },
    verify: async () => true,
    audit: async () => undefined,
    now: () => new Date(),
  });

/** Gerçek DEK'li büro (org_settings + org_keys). */
async function keyedOrg(tag: string) {
  const u = await appUser(tag);
  const org = await db.auth.insertOrg(`Büro ${tag}`, 'firm');
  await db.auth.grantSeats(org, 5);
  const m = await db.auth.insertUser({
    name: `Üye ${tag}`,
    email: `uye-${tag}.${KEY}@${DOMAIN}`,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  await db.auth.addMember(org, m, 'owner');
  const dek = randomBytes(32);
  const wrapped = wrapDek(kek.kek, { orgId: org, dekVersion: 1, kekVersion: kek.kekVersion }, dek);
  wipe(dek);
  await db.runner('eda_app').withTenant({ orgId: org, userId: m }, async (tx) => {
    await tx.query('INSERT INTO app.org_settings (org_id) VALUES ($1)', [org]);
    await tx.query(
      'INSERT INTO app.org_keys (org_id, key_version, wrapped_dek, kek_version) VALUES ($1, 1, $2, $3)',
      [org, wrapped, kek.kekVersion],
    );
  });
  return { org, member: m, spare: u.uid };
}

const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const KEYS = '/api/v1/admin/ai/keys';

describe('KK-ai-anahtar-1: yetki, step-up ve hız sınırı', () => {
  it('anonim 401; support her uca 403 ADMIN_FORBIDDEN ve veri değişmez', async () => {
    const t = await keyedOrg('yetki-a');
    expect((await call(`${KEYS}/orgs`)).status).toBe(401);
    expect(
      (await call(`${KEYS}/orgs/${t.org}`, { method: 'PUT', body: { apiKey: KEY_ORG } })).status,
    ).toBe(401);
    const s = await loggedIn('ai-destek', 'support');
    for (const [method, path, body] of [
      ['GET', `${KEYS}/platform`, undefined],
      ['GET', `${KEYS}/orgs`, undefined],
      ['GET', `${KEYS}/users`, undefined],
      ['POST', `${KEYS}/orgs/search`, { query: 'Büro' }],
      ['POST', `${KEYS}/users/search`, { query: 'uye' }],
      ['PUT', `${KEYS}/platform/key`, { apiKey: KEY_ORG, label: 'Deneme anahtarı' }],
      ['PUT', `${KEYS}/platform/key/label`, { label: 'Yeni ad' }],
      ['PUT', `${KEYS}/platform/fallback`, { enabled: false }],
      [
        'PUT',
        `${KEYS}/platform/limits`,
        {
          userTurnsPerDay: 5,
          userTokensPerDay: null,
          orgDailyCapMicroUsd: null,
        },
      ],
      ['PUT', `${KEYS}/platform/cap`, { platformDailyCapMicroUsd: 5_000_000 }],
      ['DELETE', `${KEYS}/platform/key`, undefined],
      ['PUT', `${KEYS}/orgs/${t.org}`, { apiKey: KEY_ORG }],
      ['PUT', `${KEYS}/users/${t.spare}`, { apiKey: KEY_USER }],
      ['DELETE', `${KEYS}/orgs/${t.org}`, undefined],
      ['DELETE', `${KEYS}/users/${t.spare}`, undefined],
    ] as const) {
      const r = await call(path, { method, cookie: s.cookie, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${path}`).toBe(403);
      expect(((await json(r)).error as { code: string }).code).toBe('ADMIN_FORBIDDEN');
    }
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      missing: 'org',
    });
    expect(verifyCalls).not.toContain(KEY_ORG.slice(-4));
  });

  it('step-up penceresi geçince okuma ve yazma 403 AUTH_STEP_UP_REQUIRED; kart step-up istemez', async () => {
    const t = await keyedOrg('stepup-a');
    const a = await loggedIn('ai-stepup');
    const ctx = await identity.auth.$context;
    for (const sess of await ctx.internalAdapter.listSessions(a.uid)) {
      await ctx.internalAdapter.updateSession(sess.token, {
        stepUpAt: new Date(Date.now() - 2 * 3_600_000),
      } as never);
    }
    for (const r of [
      await call(`${KEYS}/orgs`, { cookie: a.cookie }),
      await call(`${KEYS}/orgs/${t.org}`, {
        method: 'PUT',
        body: { apiKey: KEY_ORG },
        cookie: a.cookie,
      }),
    ]) {
      expect(r.status).toBe(403);
      expect(((await json(r)).error as { code: string }).code).toBe('AUTH_STEP_UP_REQUIRED');
    }
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      missing: 'org',
    });
    expect((await call(`${KEYS}/platform`, { cookie: a.cookie })).status).toBe(200);
  });

  it('girdi doğrulaması: biçimsiz anahtar, ek alan ve geçersiz kimlik reddedilir; sağlayıcıya gidilmez', async () => {
    const t = await keyedOrg('girdi-a');
    const a = await loggedIn('ai-girdi');
    const before = verifyCalls.length;
    for (const body of [{ apiKey: 'x' }, { apiKey: KEY_ORG, extra: 1 }, {}]) {
      const r = await call(`${KEYS}/orgs/${t.org}`, { method: 'PUT', body, cookie: a.cookie });
      expect(r.status).toBe(422);
    }
    const bad = await call(`${KEYS}/orgs/not-a-uuid`, {
      method: 'PUT',
      body: { apiKey: KEY_ORG },
      cookie: a.cookie,
    });
    expect(bad.status).toBe(404);
    expect(verifyCalls.length).toBe(before);
  });
});

describe('KK-ai-anahtar-2/3: büro anahtarı ataması', () => {
  it('atama: resolve anahtarı verir, yanıtta anahtar yok, denetim içeriksiz, başka büro etkilenmez, silme', async () => {
    const t = await keyedOrg('buro-a');
    const other = await keyedOrg('buro-b');
    const a = await loggedIn('ai-buro-yonetici');
    const put = await call(`${KEYS}/orgs/${t.org}`, {
      method: 'PUT',
      body: { apiKey: KEY_ORG },
      cookie: a.cookie,
    });
    expect(put.status).toBe(200);
    const text = await put.text();
    expect(JSON.parse(text)).toMatchObject({
      orgId: t.org,
      key: { configured: true, last4: 'org1' },
    });
    expect(text).not.toContain(KEY_ORG);
    expect(text).not.toContain('sk-ant');
    expect(put.headers.get('cache-control')).toContain('no-store');

    // Gerçek etki: BYOK çözümü atanan anahtarı verir (büro yuvası); diğer büro anahtarsız kalır.
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: KEY_ORG,
      source: 'org',
    });
    expect(await plainKeys().resolve({ orgId: other.org, userId: other.member })).toEqual({
      missing: 'org',
    });
    // Şifreli kolonda düz metin yok.
    const raw = await db
      .runner('eda_app')
      .withTenant({ orgId: t.org, userId: t.member }, async (tx) => {
        const r = await tx.query(
          'SELECT ai_api_key_enc AS enc FROM app.org_settings WHERE org_id = $1',
          [t.org],
        );
        return (r.rows[0] as { enc: Buffer }).enc;
      });
    expect(raw.includes(Buffer.from('sk-ant'))).toBe(false);
    expect(raw.includes(Buffer.from(KEY_ORG))).toBe(false);

    // Liste durumu: anahtar/enc alanı yok, son 4 var; arama büro adıyla bulur.
    const list = await call(`${KEYS}/orgs/search`, {
      body: { query: 'Büro buro-a' },
      cookie: a.cookie,
    });
    expect(list.status).toBe(200);
    const lt = await list.text();
    expect(lt).not.toContain(KEY_ORG);
    expect(lt).not.toContain('"enc"');
    const items = (JSON.parse(lt) as { items: { orgId: string; key: { configured: boolean } }[] })
      .items;
    expect(items.find((x) => x.orgId === t.org)?.key.configured).toBe(true);

    // Denetim: system_setting.changed / ai_key; anahtar ve son 4 hane yok.
    const audit = await db.jobsQuery<{ action: string; metadata: unknown; target_id: string }>(
      "SELECT action, metadata, target_id FROM app.audit_log WHERE actor_id = $1 AND metadata->>'scope' = 'ai_key'",
      [a.uid],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'system_setting.changed', target_id: t.org });
    expect(audit[0]?.metadata).toEqual({ scope: 'ai_key', target: 'org', change: 'set' });
    expect(JSON.stringify(audit)).not.toContain('sk-ant');
    expect(JSON.stringify(audit)).not.toContain('org1');

    // Silme: eksik kaynak döner; ikinci silme sessizce geçer ama denetim eklenmez.
    const del = await call(`${KEYS}/orgs/${t.org}`, { method: 'DELETE', cookie: a.cookie });
    expect(del.status).toBe(200);
    expect(((await json(del)).key as { configured: boolean }).configured).toBe(false);
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      missing: 'org',
    });
    await call(`${KEYS}/orgs/${t.org}`, { method: 'DELETE', cookie: a.cookie });
    const after = await db.jobsQuery(
      "SELECT 1 FROM app.audit_log WHERE actor_id = $1 AND metadata->>'scope' = 'ai_key'",
      [a.uid],
    );
    expect(after).toHaveLength(2);
  });

  it('sağlayıcının reddettiği anahtar yazılmaz (422) ve denetim satırı oluşmaz', async () => {
    const t = await keyedOrg('red-a');
    const a = await loggedIn('ai-red');
    const r = await call(`${KEYS}/orgs/${t.org}`, {
      method: 'PUT',
      body: { apiKey: REJECTED },
      cookie: a.cookie,
    });
    expect(r.status).toBe(422);
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      missing: 'org',
    });
    const audit = await db.jobsQuery(
      "SELECT 1 FROM app.audit_log WHERE actor_id = $1 AND metadata->>'scope' = 'ai_key'",
      [a.uid],
    );
    expect(audit).toHaveLength(0);
  });

  it('bilinmeyen büro 404; yeniden atama anahtarı değiştirir', async () => {
    const t = await keyedOrg('yeniden-a');
    const a = await loggedIn('ai-yeniden');
    const unknown = await call(`${KEYS}/orgs/${randomUUID()}`, {
      method: 'PUT',
      body: { apiKey: KEY_ORG },
      cookie: a.cookie,
    });
    expect(unknown.status).toBe(404);
    for (const k of [KEY_ORG, KEY_ORG2]) {
      const r = await call(`${KEYS}/orgs/${t.org}`, {
        method: 'PUT',
        body: { apiKey: k },
        cookie: a.cookie,
      });
      expect(r.status).toBe(200);
    }
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: KEY_ORG2,
      source: 'org',
    });
  });
});

describe('KK-ai-anahtar-2/3: kullanıcı anahtarı ataması', () => {
  it("atama kullanıcının own yuvasına yazılır; kaynak own olur; silme org'a döndürür; personel hedeflenemez", async () => {
    const t = await keyedOrg('kul-a');
    const other = await keyedOrg('kul-b');
    const a = await loggedIn('ai-kul-yonetici');
    const put = await call(`${KEYS}/users/${t.member}`, {
      method: 'PUT',
      body: { apiKey: KEY_USER },
      cookie: a.cookie,
    });
    expect(put.status).toBe(200);
    const text = await put.text();
    expect(text).not.toContain(KEY_USER);
    expect(JSON.parse(text)).toMatchObject({
      userId: t.member,
      source: 'own',
      key: { configured: true, last4: 'usr1' },
    });
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: KEY_USER,
      source: 'own',
    });
    // Başka kullanıcı ve başka büro etkilenmez.
    expect(await plainKeys().resolve({ orgId: other.org, userId: other.member })).toEqual({
      missing: 'org',
    });
    const raw = await db.runner('eda_app').withUserScope({ userId: t.member }, async (tx) => {
      const r = await tx.query(
        'SELECT ai_api_key_enc AS enc FROM app.user_preferences WHERE user_id = $1',
        [t.member],
      );
      return (r.rows[0] as { enc: Buffer }).enc;
    });
    expect(raw.includes(Buffer.from('sk-ant'))).toBe(false);
    expect(raw.includes(Buffer.from(KEY_USER))).toBe(false);

    const list = await call(`${KEYS}/users/search`, {
      body: { query: t.member },
      cookie: a.cookie,
    });
    expect(list.status).toBe(200);
    const lt = await list.text();
    expect(lt).not.toContain(KEY_USER);
    expect((JSON.parse(lt) as { items: { userId: string }[] }).items.map((x) => x.userId)).toEqual([
      t.member,
    ]);

    const audit = await db.jobsQuery(
      "SELECT metadata FROM app.audit_log WHERE actor_id = $1 AND target_id = $2 AND metadata->>'scope' = 'ai_key'",
      [a.uid, t.member],
    );
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain('usr1');

    const del = await call(`${KEYS}/users/${t.member}`, { method: 'DELETE', cookie: a.cookie });
    expect(del.status).toBe(200);
    expect(JSON.parse(await del.text())).toMatchObject({
      source: 'org',
      key: { configured: false },
    });
    expect(await plainKeys().resolve({ orgId: t.org, userId: t.member })).toEqual({
      missing: 'org',
    });

    // Personel hesabı hedeflenemez (listede de yok): 404.
    const staffTarget = await call(`${KEYS}/users/${a.uid}`, {
      method: 'PUT',
      body: { apiKey: KEY_USER },
      cookie: a.cookie,
    });
    expect(staffTarget.status).toBe(404);
  });
});

describe('KK-ai-anahtar-3: günlüklerde sızıntı yok', () => {
  it('atama ve silme sonrası günlük satırlarında anahtar değeri ve son 4 hane geçmez', async () => {
    const t = await keyedOrg('log-a');
    const a = await loggedIn('ai-log');
    for (const [method, path, body] of [
      ['PUT', `${KEYS}/orgs/${t.org}`, { apiKey: KEY_ORG }],
      ['PUT', `${KEYS}/users/${t.member}`, { apiKey: KEY_USER }],
      ['PUT', `${KEYS}/orgs/${t.org}`, { apiKey: REJECTED }],
      ['DELETE', `${KEYS}/orgs/${t.org}`, undefined],
      ['DELETE', `${KEYS}/users/${t.member}`, undefined],
    ] as const) {
      await call(path, { method, cookie: a.cookie, ...(body ? { body } : {}) });
    }
    const all = logLines.join('\n');
    expect(all.length).toBeGreaterThan(0);
    for (const secret of [KEY_ORG, KEY_USER, REJECTED, PLATFORM_KEY, 'org1', 'usr1', 'rjct']) {
      expect(all, secret).not.toContain(secret);
    }
  });
});

describe('KK-ai-anahtar-4: platform kartı ve platform düşüşü', () => {
  it('kart bayrak, tanımlı/yok ve son 24 saat toplamını verir; değer asla dönmez', async () => {
    const t = await keyedOrg('kart-a');
    const a = await loggedIn('ai-kart');
    await db.runner('eda_app').withTenant({ orgId: t.org, userId: t.member }, (tx) =>
      tx.query(
        `INSERT INTO app.platform_key_usage (org_id, user_id, model_alias, input_tokens, output_tokens, cost_micro_usd, status)
         VALUES ($1, $2, 'edai-flash', 1000, 500, 45, 'success')`,
        [t.org, t.member],
      ),
    );
    const r = await call(`${KEYS}/platform`, { cookie: a.cookie });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(PLATFORM_KEY);
    expect(text).not.toContain('sk-ant');
    const body = JSON.parse(text) as {
      fallbackEnabled: boolean;
      keyConfigured: boolean;
      last24h: { turns: number; tokens: number; estimatedCostMicroUsd: number };
      limits: { userTurnsPerDay: number };
    };
    expect(body.fallbackEnabled).toBe(true);
    expect(body.keyConfigured).toBe(true);
    expect(body.last24h.turns).toBeGreaterThanOrEqual(1);
    expect(body.last24h.tokens).toBeGreaterThanOrEqual(1500);
    expect(body.last24h.estimatedCostMicroUsd).toBeGreaterThanOrEqual(45);
    expect(body.limits.userTurnsPerDay).toBe(50);
  });

  it('platform düşüşü açıkken anahtarsız kullanıcı kaynak platform alır; atanan anahtar önceliklidir', async () => {
    const t = await keyedOrg('dusus-a');
    const a = await loggedIn('ai-dusus');
    const withPlatform = setup.surface.aiKeys;
    expect(await withPlatform.resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: PLATFORM_KEY,
      source: 'platform',
    });
    const st = await withPlatform.status({ orgId: t.org, userId: t.member, memberRole: 'owner' });
    expect(st).toMatchObject({ usable: true, effectiveSource: 'platform', platformFallback: true });
    expect(JSON.stringify(st)).not.toContain(PLATFORM_KEY);
    await call(`${KEYS}/orgs/${t.org}`, {
      method: 'PUT',
      body: { apiKey: KEY_ORG },
      cookie: a.cookie,
    });
    expect(await withPlatform.resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: KEY_ORG,
      source: 'org',
    });
    // Anahtar silinince yeniden platform; hiçbir zaman sessiz değil (kaynak adı açık).
    await call(`${KEYS}/orgs/${t.org}`, { method: 'DELETE', cookie: a.cookie });
    expect(await withPlatform.resolve({ orgId: t.org, userId: t.member })).toMatchObject({
      source: 'platform',
    });
  });
});

describe('KK-ai-anahtar-1: yazma hız sınırı', () => {
  it('dakikada en çok 10 değiştirici istek, sonrası 429', async () => {
    const t = await keyedOrg('hiz-a');
    const a = await loggedIn('ai-hiz');
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await call(`${KEYS}/orgs/${t.org}`, { method: 'DELETE', cookie: a.cookie });
      codes.push(r.status);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});

describe('KK-ai-anahtar-5: platform anahtarı limit kapısı (gerçek DB)', () => {
  const gate = () =>
    createPlatformKeyGate({
      db: db.runner('eda_app'),
      now: () => new Date(),
      settings: platformSettings,
    });
  const turn = async (actor: { orgId: string; userId: string }, tokens = 100) => {
    const h = await gate().begin(actor, START);
    await h.finish({
      inputTokens: tokens,
      outputTokens: 0,
      status: 'success',
    });
  };
  const member = async (
    org: string,
    tag: string,
    status: 'verified' | 'pending_verification' = 'verified',
  ) => {
    const id = await db.auth.insertUser({
      name: `Üye ${tag}`,
      email: `${tag}.${KEY}@${DOMAIN}`,
      emailVerified: true,
      verificationStatus: status,
    });
    await db.auth.addMember(org, id, 'lawyer');
    return id;
  };
  const setUserLimits = async (
    cookie: string,
    userId: string,
    v: { chatTurnsPerDay?: number | null; tokensPerDay?: number | null },
  ) => {
    const r = await call(`/api/v1/admin/users/${userId}/limits`, {
      body: {
        chatTurnsPerDay: v.chatTurnsPerDay ?? null,
        chatTurnsPerMonth: null,
        tokensPerDay: v.tokensPerDay ?? null,
        tokensPerMonth: null,
      },
      cookie,
    });
    expect(r.status).toBe(200);
  };

  it('varsayılan: kullanıcı başına günlük 50 tur; 51. tur açık hatayla reddedilir, başka kullanıcı etkilenmez', async () => {
    const t = await keyedOrg('kapi-varsayilan');
    const u = await member(t.org, 'kapi-v1');
    const actor = { orgId: t.org, userId: u };
    for (let i = 0; i < 50; i += 1) await turn(actor, 1);
    const err = await gate()
      .begin(actor, START)
      .then(
        () => null,
        (e: unknown) => e as { code: string; reason?: string; meta?: { retryAfterSec?: number } },
      );
    expect(err).toMatchObject({ code: 'QUOTA_DAILY_COST_CAP', reason: 'platform_key_user_day' });
    expect(err?.meta?.retryAfterSec).toBeGreaterThanOrEqual(60);
    // Aynı bürodaki başka kullanıcı etkilenmez.
    await turn({ orgId: t.org, userId: t.member }, 1);
  });

  it("yönetici kullanıcı geçersiz kılması gate'e yansır; token sınırı ve süren tur sayacı", async () => {
    const t = await keyedOrg('kapi-gecersiz');
    const a = await loggedIn('ai-kapi');
    const u = await member(t.org, 'kapi-g1');
    await setUserLimits(a.cookie, u, { chatTurnsPerDay: 2 });
    const actor = { orgId: t.org, userId: u };
    await turn(actor, 1);
    await turn(actor, 1);
    await expect(gate().begin(actor, START)).rejects.toMatchObject({
      code: 'QUOTA_DAILY_COST_CAP',
      reason: 'platform_key_user_day',
    });
    // Token sınırı: 100 token üst sınırı tek turla aşılır.
    const u2 = await member(t.org, 'kapi-g2');
    await setUserLimits(a.cookie, u2, { tokensPerDay: 100 });
    await turn({ orgId: t.org, userId: u2 }, 100);
    await expect(gate().begin({ orgId: t.org, userId: u2 }, START)).rejects.toMatchObject({
      reason: 'platform_key_user_day',
    });
    // Süren tur sayılır: sınır 1 iken ikinci eşzamanlı tur reddedilir; bitince kayıt zaten sayar.
    const u3 = await member(t.org, 'kapi-g3');
    await setUserLimits(a.cookie, u3, { chatTurnsPerDay: 1 });
    const g = gate();
    const first = await g.begin({ orgId: t.org, userId: u3 }, START);
    await expect(g.begin({ orgId: t.org, userId: u3 }, START)).rejects.toMatchObject({
      reason: 'platform_key_user_day',
    });
    await first.finish({
      inputTokens: 1,
      outputTokens: 1,
      status: 'stopped',
    });
  });

  it('büro günlük maliyet tavanı: tavan aşılınca büronun diğer üyeleri de reddedilir; başka büro etkilenmez', async () => {
    const t = await keyedOrg('kapi-buro');
    const other = await keyedOrg('kapi-buro-diger');
    const a = await loggedIn('ai-kapi-buro');
    for (const key of [
      'costGuard.orgDailyCapFloorMicroUsd',
      'costGuard.orgDailyCapPerSeatMicroUsd',
    ]) {
      const r = await call(`/api/v1/admin/limits/orgs/${t.org}/${key}`, {
        method: 'PUT',
        body: { value: 1 },
        cookie: a.cookie,
      });
      expect(r.status).toBe(200);
    }
    const u2 = await member(t.org, 'kapi-b2');
    await turn({ orgId: t.org, userId: t.member }, 1000);
    await expect(gate().begin({ orgId: t.org, userId: u2 }, START)).rejects.toMatchObject({
      code: 'QUOTA_DAILY_COST_CAP',
      reason: 'platform_key_org_day',
    });
    await turn({ orgId: other.org, userId: other.member }, 1000);
  });

  it('doğrulanmamış kullanıcı ortak anahtarı kullanamaz (AUTH_PENDING_VERIFICATION)', async () => {
    const t = await keyedOrg('kapi-bekleyen');
    const u = await member(t.org, 'kapi-p1', 'pending_verification');
    await expect(gate().begin({ orgId: t.org, userId: u }, START)).rejects.toMatchObject({
      code: 'AUTH_PENDING_VERIFICATION',
    });
  });
});

describe('KK-ai-anahtar-6: platform anahtarı yönetimden girilir (DB, şifreli, KEK)', () => {
  const PANEL_KEY = `sk-ant-test-${'D'.repeat(30)}pnl1`;
  const PANEL_KEY2 = `sk-ant-test-${'E'.repeat(30)}pnl2`;
  const LABEL = 'Ortak Claude anahtarı';
  const PK = `${KEYS}/platform`;
  type Card = {
    fallbackEnabled: boolean;
    fallbackSwitch: boolean;
    keyConfigured: boolean;
    active: boolean;
    key: {
      source: string | null;
      label: string | null;
      last4: string | null;
      updatedAt: string | null;
    };
    limits: {
      userTurnsPerDay: number;
      userTokensPerDay: number;
      orgDailyCapMicroUsd: number | null;
      platformDailyCapMicroUsd: number;
      custom: Record<string, number | null>;
      defaults: Record<string, number>;
    };
  };
  const cardOf = async (cookie: string): Promise<Card> =>
    (await (await call(PK, { cookie })).json()) as Card;
  const runtimeRow = () =>
    adminDbFromEnv().withAdmin(
      async (tx) =>
        (await tx.query('SELECT * FROM app.platform_settings_runtime()')).rows[0] as Record<
          string,
          unknown
        >,
    );
  const gate = () =>
    createPlatformKeyGate({
      db: db.runner('eda_app'),
      now: () => new Date(),
      settings: platformSettings,
    });
  const turn = async (actor: { orgId: string; userId: string }, tokens = 1) => {
    const h = await gate().begin(actor, START);
    await h.finish({
      inputTokens: tokens,
      outputTokens: 0,
      status: 'success',
    });
  };
  const newMember = async (org: string, tag: string) => {
    const id = await db.auth.insertUser({
      name: `Üye ${tag}`,
      email: `${tag}.${KEY}@${DOMAIN}`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, id, 'lawyer');
    return id;
  };

  afterAll(async () => {
    // Paylaşılan tek satırı varsayılana döndür (sonraki dosyalar etkilenmesin).
    const a = await loggedIn('ai-pk-temizle');
    await call(`${PK}/key`, { method: 'DELETE', cookie: a.cookie });
    await call(`${PK}/fallback`, { method: 'PUT', body: { enabled: true }, cookie: a.cookie });
    await call(`${PK}/limits`, {
      method: 'PUT',
      body: { userTurnsPerDay: null, userTokensPerDay: null, orgDailyCapMicroUsd: null },
      cookie: a.cookie,
    });
    await call(`${PK}/cap`, {
      method: 'PUT',
      body: { platformDailyCapMicroUsd: null },
      cookie: a.cookie,
    });
    fileKey = PLATFORM_KEY;
  });

  it('anahtar yazılır: kart yalnız ad/son4/kaynak verir, DB şifreli, çözümleme DB anahtarını kullanır, kullanıcıya ad görünür', async () => {
    const t = await keyedOrg('pk-yaz');
    const a = await loggedIn('ai-pk-yaz');
    // Başlangıç: yalnız sunucu sır dosyası (yedek) vardır.
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: PLATFORM_KEY,
      source: 'platform',
    });
    expect((await cardOf(a.cookie)).key).toMatchObject({ source: 'server_secret', last4: null });

    const before = verifyCalls.length;
    const put = await call(`${PK}/key`, {
      method: 'PUT',
      body: { apiKey: PANEL_KEY, label: LABEL },
      cookie: a.cookie,
    });
    expect(put.status).toBe(200);
    expect(put.headers.get('cache-control')).toContain('no-store');
    const text = await put.text();
    expect(text).not.toContain(PANEL_KEY);
    expect(text).not.toContain('sk-ant');
    expect(JSON.parse(text)).toMatchObject({
      keyConfigured: true,
      active: true,
      key: { source: 'panel', label: LABEL, last4: 'pnl1' },
    });
    // Anahtar yazılmadan önce Anthropic'e doğrulatılır.
    expect(verifyCalls.slice(before)).toEqual(['pnl1']);

    // DB: şifreli (düz metin yok), KEK türevli anahtar + AAD bağlamıyla çözülür; başka bağlamla çözülmez.
    const row = await runtimeRow();
    const enc = row.key_enc as Buffer;
    expect(enc.includes(Buffer.from('sk-ant'))).toBe(false);
    expect(enc.includes(Buffer.from(PANEL_KEY))).toBe(false);
    const derived = derivePlatformKey(kek.kek);
    expect(decryptField(derived, platformKeyContext(kek.kekVersion), enc)).toBe(PANEL_KEY);
    expect(() => decryptField(derived, platformKeyContext(kek.kekVersion + 1), enc)).toThrow();
    expect(() => decryptField(derived, orgKeyContext(t.org, kek.kekVersion), enc)).toThrow();
    wipe(derived);

    // Sohbet çözümlemesi hemen DB anahtarını kullanır (dosya yedeği değil); kaynak adı açık: platform.
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: PANEL_KEY,
      source: 'platform',
    });
    const st = await setup.surface.aiKeys.status({
      orgId: t.org,
      userId: t.member,
      memberRole: 'owner',
    });
    expect(st).toMatchObject({
      usable: true,
      effectiveSource: 'platform',
      platformFallback: true,
      platformLabel: LABEL,
    });
    expect(JSON.stringify(st)).not.toContain(PANEL_KEY);

    // Denetim: yalnız kapsam ve işlem; anahtar, ad ve son 4 hane yok.
    const audit = await db.jobsQuery<{ metadata: unknown; target_type: string }>(
      "SELECT metadata, target_type FROM app.audit_log WHERE actor_id = $1 AND metadata->>'scope' = 'platform_ai_key'",
      [a.uid],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      target_type: 'platform_settings',
      metadata: { scope: 'platform_ai_key', change: expect.stringMatching(/^(set|replaced)$/) },
    });
    const flat = JSON.stringify(audit);
    for (const secret of ['sk-ant', 'pnl1', LABEL]) expect(flat).not.toContain(secret);
  });

  it('ad değişimi anahtarı korur; yeniden atama değiştirir; silme sır dosyasına döner; dosya da yoksa eksik', async () => {
    const t = await keyedOrg('pk-ad');
    const a = await loggedIn('ai-pk-ad');
    const put = (apiKey: string, label: string) =>
      call(`${PK}/key`, { method: 'PUT', body: { apiKey, label }, cookie: a.cookie });
    expect((await put(PANEL_KEY, LABEL)).status).toBe(200);
    const ren = await call(`${PK}/key/label`, {
      method: 'PUT',
      body: { label: 'Pilot Claude' },
      cookie: a.cookie,
    });
    expect(ren.status).toBe(200);
    expect(((await json(ren)).key as { label: string }).label).toBe('Pilot Claude');
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toMatchObject({
      apiKey: PANEL_KEY,
    });
    expect(
      (await setup.surface.aiKeys.status({ orgId: t.org, userId: t.member, memberRole: 'owner' }))
        .platformLabel,
    ).toBe('Pilot Claude');
    // Yeniden atama anahtarı değiştirir.
    expect((await put(PANEL_KEY2, 'İkinci anahtar')).status).toBe(200);
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toMatchObject({
      apiKey: PANEL_KEY2,
    });
    // Silme: DB anahtarı gider, sunucu sır dosyası yedeği devreye girer.
    const del = await call(`${PK}/key`, { method: 'DELETE', cookie: a.cookie });
    expect(del.status).toBe(200);
    expect(((await json(del)).key as { source: string }).source).toBe('server_secret');
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: PLATFORM_KEY,
      source: 'platform',
    });
    expect(
      (await setup.surface.aiKeys.status({ orgId: t.org, userId: t.member, memberRole: 'owner' }))
        .platformLabel,
    ).toBeNull();
    // Dosya da yoksa: eksik kaynak (sessiz düşme yok).
    fileKey = null;
    platformSettings.invalidate();
    try {
      expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toEqual({
        missing: 'org',
      });
      expect((await cardOf(a.cookie)).keyConfigured).toBe(false);
      // Anahtar yokken yeniden adlandırma 404.
      const none = await call(`${PK}/key/label`, {
        method: 'PUT',
        body: { label: 'Olmayan anahtar' },
        cookie: a.cookie,
      });
      expect(none.status).toBe(404);
    } finally {
      fileKey = PLATFORM_KEY;
      platformSettings.invalidate();
    }
  });

  it('reddedilen anahtar yazılmaz (422); biçimsiz anahtar/ad ve ek alan sağlayıcıya gitmeden reddedilir', async () => {
    const a = await loggedIn('ai-pk-red');
    const before = verifyCalls.length;
    const rej = await call(`${PK}/key`, {
      method: 'PUT',
      body: { apiKey: REJECTED, label: LABEL },
      cookie: a.cookie,
    });
    expect(rej.status).toBe(422);
    expect(verifyCalls.length).toBe(before + 1);
    expect(((await cardOf(a.cookie)).key as { source: string | null }).source).not.toBe('panel');
    const afterReject = verifyCalls.length;
    for (const body of [
      { apiKey: 'x', label: LABEL },
      { apiKey: PANEL_KEY, label: 'ab' },
      { apiKey: PANEL_KEY, label: 'x'.repeat(61) },
      { apiKey: PANEL_KEY, label: '<b>ad</b>' },
      { apiKey: PANEL_KEY, label: 'satır\nsonu' },
      { apiKey: PANEL_KEY },
      { apiKey: PANEL_KEY, label: LABEL, extra: 1 },
    ]) {
      const r = await call(`${PK}/key`, { method: 'PUT', body, cookie: a.cookie });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    expect(verifyCalls.length).toBe(afterReject);
    const b = await loggedIn('ai-pk-red2');
    for (const body of [{ label: 'ab' }, { label: LABEL, extra: 1 }, {}]) {
      const r = await call(`${PK}/key/label`, { method: 'PUT', body, cookie: b.cookie });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
  });

  it('yumuşak anahtar: kapatılınca anahtar kullanılmaz ve durum platform göstermez; açılınca döner', async () => {
    const t = await keyedOrg('pk-yumusak');
    const a = await loggedIn('ai-pk-yumusak');
    const sw = (enabled: boolean) =>
      call(`${PK}/fallback`, { method: 'PUT', body: { enabled }, cookie: a.cookie });
    const off = await sw(false);
    expect(off.status).toBe(200);
    expect(await json(off)).toMatchObject({ fallbackSwitch: false, active: false });
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toEqual({
      missing: 'org',
    });
    expect(
      await setup.surface.aiKeys.status({ orgId: t.org, userId: t.member, memberRole: 'owner' }),
    ).toMatchObject({ usable: false, effectiveSource: null, platformFallback: false });
    expect(await json(await sw(true))).toMatchObject({ fallbackSwitch: true, active: true });
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toMatchObject({
      source: 'platform',
    });
  });

  it('env sert kapısı kapalıyken (production/staging/onprem) DB ayarı ne olursa olsun düşüş kapalıdır ve DB okunmaz', async () => {
    const t = await keyedOrg('pk-sert');
    const a = await loggedIn('ai-pk-sert');
    expect(
      (
        await call(`${PK}/key`, {
          method: 'PUT',
          body: { apiKey: PANEL_KEY, label: LABEL },
          cookie: a.cookie,
        })
      ).status,
    ).toBe(200);
    expect(
      await json(
        await call(`${PK}/fallback`, { method: 'PUT', body: { enabled: true }, cookie: a.cookie }),
      ),
    ).toMatchObject({ fallbackSwitch: true });
    let loads = 0;
    const closed = createPlatformSettings({
      envGate: false,
      load: async () => {
        loads += 1;
        throw new Error('env kapalıyken DB okunmamalı');
      },
      kek: kek.kek,
      readFileKey: () => PLATFORM_KEY,
      now: () => Date.now(),
    });
    const svc = createAiKeysService({
      db: db.runner('eda_app'),
      kek: { kek: kek.kek, kekVersion: kek.kekVersion },
      verify: async () => true,
      audit: async () => undefined,
      now: () => new Date(),
      platform: closed,
    });
    expect(await svc.resolve({ orgId: t.org, userId: t.member })).toEqual({ missing: 'org' });
    expect(await svc.status({ orgId: t.org, userId: t.member, memberRole: 'owner' })).toMatchObject(
      { usable: false, platformFallback: false, platformLabel: null },
    );
    expect(loads).toBe(0);
  });

  it('çözülemeyen DB kaydı (bozuk/yanlış bağlam) içeriksiz olay üretir ve sır dosyasına düşer', async () => {
    const t = await keyedOrg('pk-bozuk');
    const a = await loggedIn('ai-pk-bozuk');
    // Başka bağlamla şifrelenmiş değer (büro bağlamı): çözülemez.
    const wrong = (await import('@eda/crypto')).encryptField(
      derivePlatformKey(kek.kek),
      orgKeyContext(t.org, kek.kekVersion),
      PANEL_KEY2,
    );
    await adminDbFromEnv().withAdminWrite((tx) =>
      tx.query('SELECT app.admin_platform_key_set($1, $2, $3, $4, $5, now())', [
        a.uid,
        wrong,
        'pnl2',
        kek.kekVersion,
        'Bozuk kayıt',
      ]),
    );
    platformSettings.invalidate();
    platformEvents.length = 0;
    expect(await setup.surface.aiKeys.resolve({ orgId: t.org, userId: t.member })).toEqual({
      apiKey: PLATFORM_KEY,
      source: 'platform',
    });
    expect(platformEvents).toContain('ai.platform_key_decrypt_failed');
    expect(logLines.join('\n')).not.toContain(PANEL_KEY2);
    await call(`${PK}/key`, { method: 'DELETE', cookie: a.cookie });
  });

  it('limitler panelden değişir: varsayılan 50; panel değeri kapıya yansır; kullanıcı geçersiz kılması önceliklidir; sıfırlama varsayılana döner', async () => {
    const t = await keyedOrg('pk-limit');
    const a = await loggedIn('ai-pk-limit');
    const c0 = await cardOf(a.cookie);
    expect(c0.limits).toMatchObject({
      userTurnsPerDay: 50,
      custom: { userTurnsPerDay: null, userTokensPerDay: null, orgDailyCapMicroUsd: null },
      defaults: { userTurnsPerDay: 50 },
    });
    const setLimits = (body: unknown) =>
      call(`${PK}/limits`, { method: 'PUT', body, cookie: a.cookie });
    const r = await setLimits({
      userTurnsPerDay: 3,
      userTokensPerDay: 1000,
      orgDailyCapMicroUsd: null,
    });
    expect(r.status).toBe(200);
    expect(((await json(r)).limits as Card['limits']).custom).toMatchObject({
      userTurnsPerDay: 3,
      userTokensPerDay: 1000,
    });
    // Kapı, değişikliği önbellek beklemeden uygular (yönetim yazması önbelleği düşürür).
    const u1 = await newMember(t.org, 'pk-l1');
    for (let i = 0; i < 3; i += 1) await turn({ orgId: t.org, userId: u1 });
    await expect(gate().begin({ orgId: t.org, userId: u1 }, START)).rejects.toMatchObject({
      code: 'QUOTA_DAILY_COST_CAP',
      reason: 'platform_key_user_day',
    });
    // Token sınırı (panel 1000).
    const u2 = await newMember(t.org, 'pk-l2');
    await turn({ orgId: t.org, userId: u2 }, 1000);
    await expect(gate().begin({ orgId: t.org, userId: u2 }, START)).rejects.toMatchObject({
      reason: 'platform_key_user_day',
    });
    // Kullanıcı geçersiz kılması panel değerinden önceliklidir (5 tur, 1000'den fazla token).
    const u3 = await newMember(t.org, 'pk-l3');
    const ov = await call(`/api/v1/admin/users/${u3}/limits`, {
      body: {
        chatTurnsPerDay: 5,
        chatTurnsPerMonth: null,
        tokensPerDay: 100000,
        tokensPerMonth: null,
      },
      cookie: a.cookie,
    });
    expect(ov.status).toBe(200);
    for (let i = 0; i < 5; i += 1) await turn({ orgId: t.org, userId: u3 }, 500);
    await expect(gate().begin({ orgId: t.org, userId: u3 }, START)).rejects.toMatchObject({
      reason: 'platform_key_user_day',
    });
    // Panel değeri yükseltilince engellenen kullanıcı yeniden turlayabilir (3 -> 4).
    expect(
      (
        await setLimits({
          userTurnsPerDay: 4,
          userTokensPerDay: null,
          orgDailyCapMicroUsd: null,
        })
      ).status,
    ).toBe(200);
    await turn({ orgId: t.org, userId: u1 });
    // Sıfırlama: varsayılan 50'ye döner.
    const reset = await setLimits({
      userTurnsPerDay: null,
      userTokensPerDay: null,
      orgDailyCapMicroUsd: null,
    });
    expect((await json(reset)).limits).toMatchObject({ userTurnsPerDay: 50 });
    await turn({ orgId: t.org, userId: u2 });
    // Sınır dışı değerler reddedilir.
    for (const bad of [
      { userTurnsPerDay: 0, userTokensPerDay: null, orgDailyCapMicroUsd: null },
      { userTurnsPerDay: 10001, userTokensPerDay: null, orgDailyCapMicroUsd: null },
      { userTurnsPerDay: null, userTokensPerDay: 999, orgDailyCapMicroUsd: null },
      { userTurnsPerDay: null, userTokensPerDay: null, orgDailyCapMicroUsd: 1 },
      { userTurnsPerDay: 1.5, userTokensPerDay: null, orgDailyCapMicroUsd: null },
      { userTurnsPerDay: 5 },
    ]) {
      expect((await setLimits(bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('büro günlük tavanı panelden düz değer olarak ayarlanır; büro geçersiz kılması panel değerinden önceliklidir', async () => {
    const t = await keyedOrg('pk-tavan');
    const diger = await keyedOrg('pk-tavan-ov');
    const a = await loggedIn('ai-pk-tavan');
    const setCap = (cap: number | null) =>
      call(`${PK}/limits`, {
        method: 'PUT',
        body: { userTurnsPerDay: null, userTokensPerDay: null, orgDailyCapMicroUsd: cap },
        cookie: a.cookie,
      });
    expect((await setCap(100_000)).status).toBe(200);
    expect(((await cardOf(a.cookie)).limits as Card['limits']).orgDailyCapMicroUsd).toBe(100_000);
    // 10000 token ~ 150000 mikro-USD tahmini maliyet: panel tavanı (100000) aşılır.
    const u2 = await newMember(t.org, 'pk-tavan2');
    await turn({ orgId: t.org, userId: t.member }, 10_000);
    await expect(gate().begin({ orgId: t.org, userId: u2 }, START)).rejects.toMatchObject({
      reason: 'platform_key_org_day',
    });
    // Büro geçersiz kılması (org_limit_overrides) panel düz tavanından önceliklidir.
    for (const key of [
      'costGuard.orgDailyCapFloorMicroUsd',
      'costGuard.orgDailyCapPerSeatMicroUsd',
    ]) {
      const r = await call(`/api/v1/admin/limits/orgs/${diger.org}/${key}`, {
        method: 'PUT',
        body: { value: 5_000_000_000 },
        cookie: a.cookie,
      });
      expect(r.status).toBe(200);
    }
    await turn({ orgId: diger.org, userId: diger.member }, 10_000);
    const u3 = await newMember(diger.org, 'pk-tavan3');
    await turn({ orgId: diger.org, userId: u3 }, 10);
    expect((await setCap(null)).status).toBe(200);
    expect(((await cardOf(a.cookie)).limits as Card['limits']).orgDailyCapMicroUsd).toBeNull();
    await turn({ orgId: t.org, userId: u2 }, 10);
  });

  it('KK-PLATFORM-TAVAN: platform geneli günlük tavan panelden değişir, kapıya anında yansır; sınır dışı 422; varsayılana dönülür', async () => {
    const t = await keyedOrg('pk-ptavan');
    const a = await loggedIn('ai-pk-ptavan');
    const c0 = await cardOf(a.cookie);
    expect(c0.limits.platformDailyCapMicroUsd).toBe(100_000_000);
    expect(c0.limits.custom.platformDailyCapMicroUsd).toBeNull();
    const setCap = (body: unknown) => call(`${PK}/cap`, { method: 'PUT', body, cookie: a.cookie });
    const r = await setCap({ platformDailyCapMicroUsd: 1_000_000 });
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('no-store');
    const after = (await json(r)).limits as Card['limits'];
    expect(after.platformDailyCapMicroUsd).toBe(1_000_000);
    expect(after.custom.platformDailyCapMicroUsd).toBe(1_000_000);
    expect(Number((await runtimeRow()).platform_daily_cap_micro_usd)).toBe(1_000_000);
    // 100000 token ~ 1,5 USD tahmini maliyet: 1 USD tavanı aşılır; sonraki tur başlamaz (önbellek beklenmez).
    await turn({ orgId: t.org, userId: t.member }, 100_000).catch(() => undefined);
    await expect(gate().begin({ orgId: t.org, userId: t.member }, START)).rejects.toMatchObject({
      code: 'QUOTA_DAILY_COST_CAP',
      reason: 'platform_key_platform_day',
    });
    // Yükseltilince tur yeniden başlar; sıfırlama yapılandırma varsayılanına (100 USD) döner.
    expect((await setCap({ platformDailyCapMicroUsd: 50_000_000_000 })).status).toBe(200);
    await turn({ orgId: t.org, userId: t.member }, 10);
    const reset = await setCap({ platformDailyCapMicroUsd: null });
    expect(((await json(reset)).limits as Card['limits']).platformDailyCapMicroUsd).toBe(
      100_000_000,
    );
    for (const bad of [
      { platformDailyCapMicroUsd: 999_999 },
      { platformDailyCapMicroUsd: 100_000_000_001 },
      { platformDailyCapMicroUsd: 1.5 },
      { platformDailyCapMicroUsd: '5000000' },
      {},
      { platformDailyCapMicroUsd: null, extra: 1 },
    ]) {
      expect((await setCap(bad)).status, JSON.stringify(bad)).toBe(422);
    }
  });

  it('yazma uçları denetim kaydı bırakır (kapsam ve işlem); tüm uçlar anahtar/ad/son 4 hane sızdırmaz', async () => {
    const a = await loggedIn('ai-pk-denetim');
    const calls: [string, string, unknown?][] = [
      ['PUT', `${PK}/key`, { apiKey: PANEL_KEY, label: LABEL }],
      ['PUT', `${PK}/key/label`, { label: 'Yeni ad' }],
      ['PUT', `${PK}/fallback`, { enabled: false }],
      ['PUT', `${PK}/fallback`, { enabled: true }],
      [
        'PUT',
        `${PK}/limits`,
        { userTurnsPerDay: 60, userTokensPerDay: null, orgDailyCapMicroUsd: null },
      ],
      [
        'PUT',
        `${PK}/limits`,
        { userTurnsPerDay: null, userTokensPerDay: null, orgDailyCapMicroUsd: null },
      ],
      ['PUT', `${PK}/cap`, { platformDailyCapMicroUsd: 5_000_000 }],
      ['PUT', `${PK}/cap`, { platformDailyCapMicroUsd: null }],
      ['DELETE', `${PK}/key`],
    ];
    for (const [method, path, body] of calls) {
      const r = await call(path, { method, cookie: a.cookie, ...(body ? { body } : {}) });
      expect(r.status, `${method} ${path}`).toBe(200);
    }
    const audit = await db.jobsQuery<{ metadata: Record<string, unknown> }>(
      "SELECT metadata FROM app.audit_log WHERE actor_id = $1 AND target_type = 'platform_settings' ORDER BY created_at",
      [a.uid],
    );
    expect(audit.map((x) => `${x.metadata.scope}:${x.metadata.change ?? 'v'}`)).toEqual(
      [
        'platform_ai_key:set',
        'platform_ai_key:renamed',
        'platform_ai_fallback:v',
        'platform_ai_fallback:v',
        'platform_ai_limits:v',
        'platform_ai_limits:v',
        'platform_ai_cap:v',
        'platform_ai_cap:v',
        'platform_ai_key:removed',
      ].map((x) =>
        x === 'platform_ai_key:set' ? expect.stringMatching(/^platform_ai_key:(set|replaced)$/) : x,
      ),
    );
    const flat = JSON.stringify(audit);
    for (const secret of ['sk-ant', 'pnl1', LABEL, 'Yeni ad', PANEL_KEY]) {
      expect(flat, secret).not.toContain(secret);
    }
    const all = logLines.join('\n');
    for (const secret of [PANEL_KEY, PANEL_KEY2, 'pnl1', 'pnl2', LABEL, 'Yeni ad']) {
      expect(all, secret).not.toContain(secret);
    }
  });
});
