// @tk TK-04 TK-05 TK-07
// Yönetim "Kullanıcılar ve kullanıcı limitleri" modülü (gerçek PostgreSQL + Valkey + Better Auth):
//  KK-053-11-4   liste/arama/süzgeç/imleç, ayrıntı sayaçları, içerik sızıntısı yok
//  KK-053-11-10  askı, oturum sonlandırma, kullanıcıya özel limitler, denetim kaydı; personel hesabında eylem yok
//  KK-053-11-3   support yalnız okur; anonim 401; step-up penceresi geçince 403; yazma hız sınırı
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createAdminService } from '../../src/admin/service.ts';
import { createAdminUsersService } from '../../src/admin/users-service.ts';
import { createAdminSurface } from '../../src/admin-app.ts';
import { createAppSurface } from '../../src/app.ts';
import { ADMIN_SESSION_COOKIE } from '../../src/auth/admin-auth.ts';
import { createAdminIdentity } from '../../src/auth/admin-identity.ts';
import { defaultAuthDb, valkeyReplayGuard, valkeySecondaryStorage } from '../../src/auth/index.ts';
import { hashPassword } from '../../src/auth/password.ts';
import { closeAuthDbPool } from '../../src/auth/pool.ts';
import { createStaff } from '../../src/auth/staff.ts';
import { createValkeyClient } from '../../src/clients/valkey.ts';
import { createReadiness } from '../../src/health/ready.ts';
import { type IdentitySetup, setupIdentity } from '../../src/identity.ts';
import { RateLimiter } from '../../src/middleware/rate-limit.ts';
import { softAuthenticator } from './webauthn.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
    valkey: { url: string; username: string; passwordFile: string };
  }
}

const APP_URL = 'https://app.ornek.test';
const PASSWORD = 'Guclu-ve-uzun-parola-2026';
const ADMIN_URL = 'https://admin.ornek.test';
const DOMAIN = 'ornek.test';
const KEY = randomUUID().slice(0, 8);
const CHALLENGE = '__Host-eda-admin.passkey_challenge';

let db: TestingDb;
let redis: Redis;
let queueRedis: Redis;
let setup: IdentitySetup;
let app: ReturnType<typeof createAppSurface>['app'];
let admin: ReturnType<typeof createAdminSurface>;
let identity: ReturnType<typeof createAdminIdentity>;
let ipSeq = Math.floor(Math.random() * 60_000);
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.31`;
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

/** Gerçek uygulama oturumları: parola hesabı eklenir ve uygulama yüzeyinden n kez oturum açılır. */
async function userWithSessions(tag: string, n: number) {
  const u = await appUser(tag);
  const hash = await hashPassword(PASSWORD, { memoryCost: 8192, timeCost: 1, parallelism: 1 });
  await db.auth.insertCredential(u.uid, hash);
  for (let i = 0; i < n; i += 1) {
    const res = await app.request(`${APP_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        origin: APP_URL,
        'content-type': 'application/json',
        'x-forwarded-for': freshIp(),
      },
      body: JSON.stringify({ email: u.email, password: PASSWORD }),
    });
    expect(res.status, `oturum ${i}`).toBe(200);
  }
  return u;
}

async function auditRows(actorId: string) {
  return db.jobsQuery<{ action: string; target_id: string; metadata: Record<string, unknown> }>(
    'SELECT action, target_id, metadata FROM app.audit_log WHERE actor_id = $1 ORDER BY created_at, id',
    [actorId],
  );
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
    destination: { write: () => undefined },
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
  });
  const appState = { draining: false };
  app = createAppSurface({
    surface: 'app',
    logger,
    state: appState,
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 65_536,
    ready: createReadiness({ probes: [], cacheMs: 0, version: 'test', state: appState }),
    identity: setup.surface,
  }).app;
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

type ListBody = {
  items: { userId: string; shortId: string; userEmail: string }[];
  nextCursor: string | null;
};

describe('KK-053-11-4: kullanıcı listesi, arama ve imleç', () => {
  it('e-posta öneki, kısa kimlik ve süzgeçle bulur; imleç sayfaları birleşince hepsi gelir', async () => {
    const a = await loggedIn('liste-yonetici');
    const prefix = `pgx-${KEY}`;
    const u1 = await appUser(`${prefix}-1`);
    const u2 = await appUser(`${prefix}-2`);
    const u3 = await appUser(`${prefix}-3`, 'pending_verification');

    const search = await call('/api/v1/admin/users/search', {
      body: { query: prefix, limit: 2, platformRole: 'user' },
      cookie: a.cookie,
    });
    expect(search.status).toBe(200);
    expect(((await search.json()) as ListBody).items).toHaveLength(2);
    const mine = await call('/api/v1/admin/users/search', {
      body: { query: `${prefix}-1`.toUpperCase() },
      cookie: a.cookie,
    });
    const m = (await mine.json()) as ListBody;
    // Arama büyük/küçük harf duyarsızdır (e-posta küçük harfle saklanır); yalnız o kullanıcı.
    expect(m.items.map((x) => x.userId)).toEqual([u1.uid]);
    expect(m.items[0]?.shortId).toBe(u1.uid.slice(-8));

    const byShort = (await (
      await call('/api/v1/admin/users/search', {
        body: { query: u2.uid.slice(-8) },
        cookie: a.cookie,
      })
    ).json()) as ListBody;
    expect(byShort.items.map((x) => x.userId)).toContain(u2.uid);
    const byFull = (await (
      await call('/api/v1/admin/users/search', { body: { query: u3.uid }, cookie: a.cookie })
    ).json()) as ListBody;
    expect(byFull.items.map((x) => x.userId)).toEqual([u3.uid]);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 6; i += 1) {
      const r = await call('/api/v1/admin/users/search', {
        body: { query: prefix, limit: 1, ...(cursor ? { cursor } : {}) },
        cookie: a.cookie,
      });
      expect(r.status).toBe(200);
      const b = (await r.json()) as ListBody;
      for (const it of b.items) seen.push(it.userId);
      if (b.nextCursor === null) break;
      cursor = b.nextCursor;
    }
    expect(seen).toHaveLength(3);
    expect([...seen].sort()).toEqual([u1.uid, u2.uid, u3.uid].sort());

    const pending = (await (
      await call('/api/v1/admin/users?verificationStatus=pending_verification&limit=100', {
        cookie: a.cookie,
      })
    ).json()) as ListBody;
    expect(pending.items.map((x) => x.userId)).toContain(u3.uid);
    expect(pending.items.map((x) => x.userId)).not.toContain(u1.uid);
  });

  it('imleç mikrosaniye hassasiyetlidir: aynı milisaniyedeki kayıtlar atlanmaz', async () => {
    const a = await loggedIn('liste-mikro');
    const prefix = `mikro-${KEY}`;
    const ids: string[] = [];
    for (const [n, micros] of [
      ['1', '123456'],
      ['2', '123789'],
      ['3', '123123'],
    ] as const) {
      ids.push(
        await db.auth.insertUserCreatedAt(
          `Örnek mikro ${n}`,
          `${prefix}-${n}@${DOMAIN}`,
          `2026-02-02 00:00:00.${micros}`,
        ),
      );
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 6; i += 1) {
      const r = await call('/api/v1/admin/users/search', {
        body: { query: prefix, limit: 1, ...(cursor ? { cursor } : {}) },
        cookie: a.cookie,
      });
      const b = (await r.json()) as ListBody;
      for (const it of b.items) seen.push(it.userId);
      if (b.nextCursor === null) break;
      cursor = b.nextCursor;
    }
    expect(seen).toEqual([ids[1], ids[0], ids[2]]);
  });

  it('geçersiz imleç 400, tek karakterlik arama 422, bilinmeyen alan 422', async () => {
    const a = await loggedIn('liste-gecersiz');
    const bad = await call('/api/v1/admin/users?cursor=bozuk', { cookie: a.cookie });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe(
      'VALIDATION_CURSOR_INVALID',
    );
    const short = await call('/api/v1/admin/users/search', {
      body: { query: 'a' },
      cookie: a.cookie,
    });
    expect(short.status).toBe(422);
    const extra = await call('/api/v1/admin/users/search', { body: { x: 1 }, cookie: a.cookie });
    expect(extra.status).toBe(422);
  });

  it('ayrıntı sayaç ve güvenlik özetini verir; içerik ve ad alanı yoktur', async () => {
    const a = await loggedIn('detay-yonetici');
    const u = await appUser('detay');
    await db.runner('eda_owner').withTenant({ orgId: u.org, userId: u.uid }, async (tx) => {
      const c = await tx.query<{ id: string }>(
        `INSERT INTO app.conversations (org_id, user_id, title) VALUES ($1, $2, 'GİZLİ-BAŞLIK-ÖRNEĞİ') RETURNING id`,
        [u.org, u.uid],
      );
      const conv = c.rows[0]?.id ?? '';
      for (const text of ['GİZLİ-MESAJ-1', 'GİZLİ-MESAJ-2']) {
        await tx.query(
          `INSERT INTO app.messages (org_id, conversation_id, role, user_id, parts)
           VALUES ($1, $2, 'user', $3, $4::jsonb)`,
          [u.org, conv, u.uid, JSON.stringify([{ type: 'text', text }])],
        );
      }
      await tx.query(
        `INSERT INTO app.ai_usage (org_id, user_id, task, model_alias, provider_id, model_id, region,
           data_class, thinking, pricing_window, status, input_tokens, output_tokens, reasoning_tokens)
         VALUES ($1, $2, 'chat', 'edai-flash', 'ornek', 'ornek-model', 'NONE', 'client', 'off', 'flat',
           'success', 100, 50, 10)`,
        [u.org, u.uid],
      );
    });
    const r = await call(`/api/v1/admin/users/${u.uid}`, { cookie: a.cookie });
    expect(r.status).toBe(200);
    const text = await r.text();
    const d = JSON.parse(text) as {
      user: { userEmail: string; orgCount: number };
      security: { passkeyCount: number; totpEnabled: boolean; activeSessions: number };
      usage: Record<string, number>;
      limits: {
        overrides: Record<string, number | null>;
        effective: Record<string, number | null>;
      };
    };
    expect(d.user.userEmail).toBe(u.email);
    expect(d.user.orgCount).toBe(1);
    expect(d.security).toEqual({ passkeyCount: 0, totpEnabled: false, activeSessions: 0 });
    expect(d.usage).toMatchObject({
      conversationsTotal: 1,
      chatTurnsToday: 2,
      chatTurnsMonth: 2,
      tokensToday: 160,
      tokensMonth: 160,
    });
    expect(Object.values(d.limits.overrides).every((v) => v === null)).toBe(true);
    // İçerik sızıntısı yok: başlık, mesaj metni ve kişi adı yanıtta geçmez.
    expect(text).not.toContain('GİZLİ');
    expect(text).not.toContain(`Kullanıcı detay`);
    expect(text).not.toMatch(/"(name|email|title|parts|text)"/);
    // Olmayan kullanıcı 404, kimlik biçimi bozuksa 404.
    expect((await call(`/api/v1/admin/users/${randomUUID()}`, { cookie: a.cookie })).status).toBe(
      404,
    );
    expect((await call('/api/v1/admin/users/xyz', { cookie: a.cookie })).status).toBe(404);
  });
});

describe('KK-053-11-10: askı ve oturum sonlandırma', () => {
  it('askı: banned yazılır, oturumlar kapanır, denetim satırı yazılır; tekrar askı no-op', async () => {
    const a = await loggedIn('aski-yonetici');
    const u = await userWithSessions('aski', 1);
    expect(await db.auth.sessionCount(u.uid)).toBe(1);

    const noReason = await call(`/api/v1/admin/users/${u.uid}/suspend`, {
      body: { suspended: true },
      cookie: a.cookie,
    });
    expect(noReason.status).toBe(422);

    const ok = await call(`/api/v1/admin/users/${u.uid}/suspend`, {
      body: { suspended: true, reasonCode: 'abuse' },
      cookie: a.cookie,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      accountStatus: 'suspended',
      changed: true,
      revokedSessions: 1,
    });
    expect(await db.auth.sessionCount(u.uid)).toBe(0);
    expect(await db.auth.banState(u.uid)).toEqual({ banned: true, banReason: 'abuse' });

    const again = await call(`/api/v1/admin/users/${u.uid}/suspend`, {
      body: { suspended: true, reasonCode: 'security' },
      cookie: a.cookie,
    });
    expect(((await again.json()) as { changed: boolean }).changed).toBe(false);

    const detail = (await (
      await call(`/api/v1/admin/users/${u.uid}`, { cookie: a.cookie })
    ).json()) as {
      account: { status: string; suspendReasonCode: string | null };
    };
    expect(detail.account).toEqual({ status: 'suspended', suspendReasonCode: 'abuse' });

    const lifted = await call(`/api/v1/admin/users/${u.uid}/suspend`, {
      body: { suspended: false },
      cookie: a.cookie,
    });
    expect(lifted.status).toBe(200);
    expect(await lifted.json()).toMatchObject({ accountStatus: 'active', changed: true });

    const audit = (await auditRows(a.uid)).filter((r) => r.target_id === u.uid);
    expect(audit.map((r) => r.action)).toEqual(['admin.user.suspended', 'admin.user.unsuspended']);
    expect(audit[0]?.metadata).toEqual({ reasonCode: 'abuse' });
  });

  it('oturum sonlandırma: sayı döner, oturumlar silinir, denetim satırı yazılır', async () => {
    const a = await loggedIn('oturum-yonetici');
    const u = await userWithSessions('oturum', 2);
    expect(await db.auth.sessionCount(u.uid)).toBe(2);
    const r = await call(`/api/v1/admin/users/${u.uid}/sessions/revoke`, {
      method: 'POST',
      cookie: a.cookie,
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ userId: u.uid, revokedSessions: 2 });
    expect(await db.auth.sessionCount(u.uid)).toBe(0);
    const audit = (await auditRows(a.uid)).filter((x) => x.target_id === u.uid);
    expect(audit).toEqual([
      { action: 'admin.session.revoked', target_id: u.uid, metadata: { count: 2 } },
    ]);
  });

  it('personel hesabı üzerinde askı, oturum ve limit eylemi 403; hiçbir izin yazılmaz', async () => {
    const a = await loggedIn('personel-yonetici');
    const other = await loggedIn('personel-hedef', 'support');
    for (const [path, body] of [
      [`/api/v1/admin/users/${other.uid}/suspend`, { suspended: true, reasonCode: 'other' }],
      [`/api/v1/admin/users/${other.uid}/sessions/revoke`, undefined],
      [
        `/api/v1/admin/users/${other.uid}/limits`,
        { chatTurnsPerDay: 1, chatTurnsPerMonth: null, tokensPerDay: null, tokensPerMonth: null },
      ],
    ] as const) {
      const r = await call(path, { method: 'POST', cookie: a.cookie, ...(body ? { body } : {}) });
      expect(r.status, path).toBe(403);
    }
    expect((await db.auth.banState(other.uid))?.banned).toBe(false);
    // Yeni yollar dışında yönetim eylemi yoktur: parola/rol/silme uçları 404.
    for (const p of ['password', 'role', 'impersonate']) {
      const r = await call(`/api/v1/admin/users/${other.uid}/${p}`, {
        method: 'POST',
        body: {},
        cookie: a.cookie,
      });
      expect(r.status, p).toBe(404);
    }
    expect(
      (await call(`/api/v1/admin/users/${other.uid}`, { method: 'DELETE', cookie: a.cookie }))
        .status,
    ).toBe(404);
  });
});

describe('KK-053-11-10: kullanıcıya özel limitler', () => {
  it('belirle, geçerli değeri oku, sıfırla; denetim satırı ve RLS izolasyonu', async () => {
    const a = await loggedIn('limit-yonetici');
    const u = await appUser('limit');
    const other = await appUser('limit-baska');
    const set = await call(`/api/v1/admin/users/${u.uid}/limits`, {
      body: {
        chatTurnsPerDay: 20,
        chatTurnsPerMonth: null,
        tokensPerDay: 5000,
        tokensPerMonth: 100000,
      },
      cookie: a.cookie,
    });
    expect(set.status).toBe(200);
    const d = (await set.json()) as {
      limits: {
        overrides: Record<string, number | null>;
        defaults: Record<string, number | null>;
        effective: Record<string, number | null>;
        overriddenAt: string | null;
      };
    };
    expect(d.limits.overrides).toEqual({
      chatTurnsPerDay: 20,
      chatTurnsPerMonth: null,
      tokensPerDay: 5000,
      tokensPerMonth: 100000,
    });
    // Geçersiz kılma olmayan alan varsayılan zincirden gelir (varsayılan: sınırsız).
    expect(d.limits.effective.chatTurnsPerMonth).toBe(d.limits.defaults.chatTurnsPerMonth);
    expect(d.limits.effective.chatTurnsPerDay).toBe(20);
    expect(d.limits.overriddenAt).not.toBeNull();

    // Kişi yalnız kendi satırını görür (RLS, kullanıcı kapsamı).
    const own = await db
      .runner('eda_app')
      .withUserScope({ userId: u.uid }, (tx) =>
        tx.query('SELECT chat_turns_per_day FROM app.user_limit_overrides'),
      );
    expect(own.rows).toEqual([{ chat_turns_per_day: 20 }]);
    const foreign = await db
      .runner('eda_app')
      .withUserScope({ userId: other.uid }, (tx) =>
        tx.query('SELECT 1 FROM app.user_limit_overrides'),
      );
    expect(foreign.rowCount).toBe(0);

    const reset = await call(`/api/v1/admin/users/${u.uid}/limits/reset`, {
      method: 'POST',
      cookie: a.cookie,
    });
    expect(reset.status).toBe(200);
    const r = (await reset.json()) as {
      limits: { overrides: Record<string, number | null>; overriddenAt: string | null };
    };
    expect(Object.values(r.limits.overrides).every((v) => v === null)).toBe(true);
    expect(r.limits.overriddenAt).toBeNull();
    const left = await db.ownerQuery('SELECT 1 FROM app.user_limit_overrides WHERE user_id = $1', [
      u.uid,
    ]);
    expect(left).toHaveLength(0);

    const audit = (await auditRows(a.uid)).filter((x) => x.target_id === u.uid);
    expect(audit.map((x) => x.action)).toEqual([
      'system_setting.changed',
      'system_setting.changed',
    ]);
    expect(audit[0]?.metadata).toMatchObject({
      scope: 'user_limit',
      chatTurnsPerDay: 20,
      tokensPerDay: 5000,
    });
  });

  it('negatif, ondalık ve üst sınır aşan değerler 422; eksik alan 422', async () => {
    const a = await loggedIn('limit-gecersiz-yonetici');
    const u = await appUser('limit-gecersiz');
    const base = {
      chatTurnsPerDay: null,
      chatTurnsPerMonth: null,
      tokensPerDay: null,
      tokensPerMonth: null,
    };
    for (const patch of [
      { chatTurnsPerDay: -1 },
      { tokensPerDay: 1.5 },
      { chatTurnsPerMonth: 2_000_000 },
      { tokensPerMonth: 1e12 },
    ]) {
      const r = await call(`/api/v1/admin/users/${u.uid}/limits`, {
        body: { ...base, ...patch },
        cookie: a.cookie,
      });
      expect(r.status, JSON.stringify(patch)).toBe(422);
    }
    const missing = await call(`/api/v1/admin/users/${u.uid}/limits`, {
      body: { chatTurnsPerDay: 3 },
      cookie: a.cookie,
    });
    expect(missing.status).toBe(422);
    const none = await db.ownerQuery('SELECT 1 FROM app.user_limit_overrides WHERE user_id = $1', [
      u.uid,
    ]);
    expect(none).toHaveLength(0);
  });
});

describe('KK-053-11-3: yetki, step-up ve hız sınırı', () => {
  it('support okur; her değiştirici uç 403 ADMIN_FORBIDDEN ve veri değişmez', async () => {
    const s = await loggedIn('destek-kullanici', 'support');
    const u = await appUser('destek-hedef');
    expect((await call('/api/v1/admin/users', { cookie: s.cookie })).status).toBe(200);
    expect(
      (await call('/api/v1/admin/users/search', { body: { query: 'destek' }, cookie: s.cookie }))
        .status,
    ).toBe(200);
    expect((await call(`/api/v1/admin/users/${u.uid}`, { cookie: s.cookie })).status).toBe(200);
    for (const [path, body] of [
      [`/api/v1/admin/users/${u.uid}/suspend`, { suspended: true, reasonCode: 'abuse' }],
      [`/api/v1/admin/users/${u.uid}/sessions/revoke`, undefined],
      [
        `/api/v1/admin/users/${u.uid}/limits`,
        { chatTurnsPerDay: 1, chatTurnsPerMonth: null, tokensPerDay: null, tokensPerMonth: null },
      ],
      [`/api/v1/admin/users/${u.uid}/limits/reset`, undefined],
    ] as const) {
      const r = await call(path, { method: 'POST', cookie: s.cookie, ...(body ? { body } : {}) });
      expect(r.status, path).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('ADMIN_FORBIDDEN');
    }
    expect((await db.auth.banState(u.uid))?.banned).toBe(false);
    expect((await auditRows(s.uid)).filter((x) => x.target_id === u.uid)).toHaveLength(0);
  });

  it('oturumsuz istek 401; step-up penceresi geçince okuma ve yazma 403 AUTH_STEP_UP_REQUIRED', async () => {
    const u = await appUser('stepup-hedef');
    expect((await call('/api/v1/admin/users')).status).toBe(401);
    expect(
      (await call(`/api/v1/admin/users/${u.uid}/suspend`, { body: { suspended: false } })).status,
    ).toBe(401);
    const a = await loggedIn('stepup-kullanici');
    const ctx = await identity.auth.$context;
    for (const sess of await ctx.internalAdapter.listSessions(a.uid)) {
      await ctx.internalAdapter.updateSession(sess.token, {
        stepUpAt: new Date(Date.now() - 2 * 3_600_000),
      } as never);
    }
    for (const r of [
      await call('/api/v1/admin/users', { cookie: a.cookie }),
      await call(`/api/v1/admin/users/${u.uid}/suspend`, {
        body: { suspended: true, reasonCode: 'abuse' },
        cookie: a.cookie,
      }),
    ]) {
      expect(r.status).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe(
        'AUTH_STEP_UP_REQUIRED',
      );
    }
    expect((await db.auth.banState(u.uid))?.banned).toBe(false);
  });

  it('yazma hız sınırı: dakikada en çok 10 değiştirici istek, sonrası 429', async () => {
    const a = await loggedIn('hiz-yonetici');
    const u = await appUser('hiz-hedef');
    const codes: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await call(`/api/v1/admin/users/${u.uid}/limits/reset`, {
        method: 'POST',
        cookie: a.cookie,
      });
      codes.push(r.status);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });
});
