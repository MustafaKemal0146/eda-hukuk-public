// @tk TK-04 TK-05 TK-07
// P27a yönetim kimliği (gerçek PostgreSQL + Valkey + Better Auth 1.7.7; ayrı `adminAuth` örneği).
//  KK-P27a-2  izinli yollar (parola+TOTP ve passkey dışı yollar 404); kayıt belirteci tek kullanımlık
//  (parola+TOTP girişi: admin-2fa.int.test.ts)
//  KK-P27a-3  kayıt oturumu platformGate'ten geçmez; kayıttan sonra passkey ile giriş (mfa=passkey)
//  KK-P27a-4  çerez adı `__Host-eda-admin.`; uygulama çerezi yönetimde, yönetim çerezi uygulamada geçmez
//  KK-P27a-5  `platform_role=user` yönetim oturumu açamaz; yasaklı personel oturumu reddedilir
//  KK-P27a-6  son passkey silinemez; rol yalnız CLI ile verilir (HTTP rol ucu yok)
import { randomUUID } from 'node:crypto';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createAdminService } from '../../src/admin/service.ts';
import { createAdminSurface } from '../../src/admin-app.ts';
import { ADMIN_SESSION_COOKIE } from '../../src/auth/admin-auth.ts';
import { createAdminIdentity } from '../../src/auth/admin-identity.ts';
import { defaultAuthDb, valkeyReplayGuard, valkeySecondaryStorage } from '../../src/auth/index.ts';
import { closeAuthDbPool } from '../../src/auth/pool.ts';
import { createStaff, reenrollStaff } from '../../src/auth/staff.ts';
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
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.26`;
};

async function call(
  path: string,
  o: { method?: string; body?: unknown; cookie?: string; ip?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    origin: ADMIN_URL,
    'x-forwarded-for': o.ip ?? freshIp(),
  };
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
    },
  );
});

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

describe('KK-P27a-2: izinli yollar', () => {
  it('kayıt, rol, 2FA yönetimi, yedek kod ve büro yolları 404; parola yolu açık', async () => {
    for (const [method, path] of [
      ['POST', '/api/auth/sign-up/email'],
      ['POST', '/api/auth/two-factor/enable'],
      ['POST', '/api/auth/two-factor/disable'],
      ['POST', '/api/auth/two-factor/get-totp-uri'],
      ['POST', '/api/auth/two-factor/verify-backup-code'],
      ['POST', '/api/auth/request-password-reset'],
      ['POST', '/api/auth/admin/set-role'],
      ['POST', '/api/auth/organization/create'],
    ] as const) {
      const r = await call(path, { method, body: { x: 1 } });
      expect(r.status, `${method} ${path}`).toBe(404);
    }
    const open = await call('/api/auth/sign-in/email', {
      body: { email: `yok.${KEY}@${DOMAIN}`, password: 'Yanlis-parola-2026' },
    });
    expect(open.status).toBe(401);
  });

  it('kayıt belirteci tek kullanımlıktır; geçersiz belirteç 400', async () => {
    const s = await staff('tek-kullanim');
    const first = await call('/api/auth/staff/enroll', { body: { token: s.token } });
    expect(first.status).toBe(200);
    const again = await call('/api/auth/staff/enroll', { body: { token: s.token } });
    expect(again.status).toBe(400);
    const bad = await call('/api/auth/staff/enroll', { body: { token: 'x'.repeat(43) } });
    expect(bad.status).toBe(400);
  });
});

describe('KK-P27a-3/4: kayıt, giriş ve çerez', () => {
  it('kayıt oturumu panelden geçmez; kayıttan sonra passkey ile giriş mfa=passkey verir', async () => {
    const s = await staff('giris');
    const { auth, enrollCookie, reg } = await enroll(s.token);
    expect(reg.status).toBe(200);
    // Kayıt oturumu kapanır ve platformGate'ten zaten geçemezdi.
    const me0 = await call('/api/v1/admin/me', { cookie: enrollCookie });
    expect(me0.status).toBe(401);
    expect(await db.auth.passkeyCount(s.uid)).toBe(1);

    const ok = await login(auth);
    expect(ok.status).toBe(200);
    const set = ok.headers.getSetCookie();
    expect(set.length).toBeGreaterThan(0);
    for (const c of set) {
      expect(c).toMatch(/^__Host-eda-admin\./);
      expect(c).toContain('Secure');
      expect(c).toContain('HttpOnly');
      expect(c).toContain('SameSite=Lax');
      expect(c).toContain('Path=/');
      expect(c).not.toContain('Domain');
    }
    const cookie = cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '';
    const me = await call('/api/v1/admin/me', { cookie });
    expect(me.status).toBe(200);
    const body = (await me.json()) as {
      platformRole: string;
      environment: string;
      session: { stepUpValidUntil: string | null };
    };
    expect(body.platformRole).toBe('super_admin');
    expect(body.environment).toBe('test');
    expect(body.session.stepUpValidUntil).not.toBeNull();
    expect((await db.auth.sessionRows(s.uid)).at(-1)?.mfaLevel).toBe('passkey');
  });

  it('uygulama çerezi yönetimde geçmez; oturumsuz /me 401', async () => {
    const r = await call('/api/v1/admin/me', {
      cookie: '__Host-eda.session_token=sahte.deger',
    });
    expect(r.status).toBe(401);
    expect((await call('/api/v1/admin/me')).status).toBe(401);
  });

  it('sayaç geriye giderse (klon şüphesi) giriş reddedilir', async () => {
    const s = await staff('sayac');
    const { auth } = await enroll(s.token);
    expect((await login(auth)).status).toBe(200);
    expect((await login(auth)).status).toBe(200);
    const cloned = await login(auth, 0);
    expect(cloned.status).toBeGreaterThanOrEqual(400);
  });
});

describe('KK-P27a-5/6: rol, askı ve son passkey', () => {
  it('platform_role=user yönetimde oturum açamaz', async () => {
    const s = await staff('rol');
    const { auth } = await enroll(s.token);
    await db.auth.setPlatformRole(s.uid, 'user');
    const r = await login(auth);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.headers.getSetCookie().some((c) => c.startsWith(ADMIN_SESSION_COOKIE))).toBe(false);
  });

  it("yasaklanan personelin açık oturumu platformGate'te kapanır", async () => {
    const s = await staff('yasak');
    const { auth } = await enroll(s.token);
    const ok = await login(auth);
    const cookie = cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '';
    expect((await call('/api/v1/admin/me', { cookie })).status).toBe(200);
    await db.auth.setVerification(s.uid, 'suspended');
    const denied = await call('/api/v1/admin/me', { cookie });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe(
      'ADMIN_FORBIDDEN',
    );
  });

  it('son passkey silinemez', async () => {
    const s = await staff('son-passkey');
    const { auth } = await enroll(s.token);
    const ok = await login(auth);
    const cookie = cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '';
    const list = await call('/api/auth/passkey/list-user-passkeys', { cookie });
    const keys = (await list.json()) as { id: string }[];
    expect(keys).toHaveLength(1);
    const del = await call('/api/auth/passkey/delete-passkey', {
      body: { id: keys[0]?.id },
      cookie,
    });
    expect(del.status).toBe(400);
    expect(await db.auth.passkeyCount(s.uid)).toBe(1);
  });
});

// --- P27a/b veri uçları ---------------------------------------------------------------------------

async function loggedIn(tag: string, role: 'super_admin' | 'support' = 'super_admin') {
  const s = await staff(tag, role);
  const { auth } = await enroll(s.token);
  const ok = await login(auth);
  expect(ok.status).toBe(200);
  return { ...s, cookie: cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '' };
}

/** Meslek başvurusu bekleyen kullanıcı + bireysel büro (onayda deneme açılır). */
async function pendingApplicant(tag: string) {
  const email = `${tag}.${KEY}@${DOMAIN}`;
  const uid = await db.auth.insertUser({
    name: `Başvuran ${tag}`,
    email,
    emailVerified: true,
    verificationStatus: 'pending_verification',
  });
  const org = await db.auth.insertOrg(`Bireysel ${tag}`, 'individual');
  await db.auth.addMember(org, uid, 'owner');
  await db.runner('eda_owner').withUserScope({ userId: uid }, async (tx) => {
    await tx.query(
      `INSERT INTO app.lawyer_profiles (user_id, baro, sicil_no, verification_source)
       VALUES ($1, 'Ankara', $2, 'admin_review')`,
      [uid, String(100000 + Math.floor(Math.random() * 800000))],
    );
  });
  return { uid, email, org };
}

describe('KK-P27b-1: başvuru kuyruğu ve karar', () => {
  it('bekleyenler listelenir; onay doğrulanmış yapar ve deneme açar; tekrar onay 404', async () => {
    const a = await loggedIn('onay-yonetici');
    const p = await pendingApplicant('onay');
    const list = await call('/api/v1/admin/applications?status=pending_verification', {
      cookie: a.cookie,
    });
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: { userId: string; baro: string }[] };
    expect(body.items.some((x) => x.userId === p.uid && x.baro === 'Ankara')).toBe(true);

    const ok = await call(`/api/v1/admin/applications/${p.uid}/approve`, {
      body: {},
      cookie: a.cookie,
    });
    expect(ok.status).toBe(200);
    expect(await db.auth.userState(p.uid)).toMatchObject({ verificationStatus: 'verified' });
    const subs = await db
      .runner('eda_owner')
      .withTenant({ orgId: p.org, userId: p.uid }, async (tx) =>
        tx.query<{ plan_code: string }>(
          'SELECT plan_code FROM app.subscriptions WHERE org_id = $1',
          [p.org],
        ),
      );
    expect(subs.rows.map((r) => r.plan_code)).toContain('trial');

    const again = await call(`/api/v1/admin/applications/${p.uid}/approve`, {
      body: {},
      cookie: a.cookie,
    });
    expect(again.status).toBe(404);
  });

  it('ret yalnız kapalı neden koduyla; kullanıcı rejected olur', async () => {
    const a = await loggedIn('ret-yonetici');
    const p = await pendingApplicant('ret');
    const bad = await call(`/api/v1/admin/applications/${p.uid}/reject`, {
      body: { reasonCode: 'serbest metin' },
      cookie: a.cookie,
    });
    expect(bad.status).toBe(422);
    const ok = await call(`/api/v1/admin/applications/${p.uid}/reject`, {
      body: { reasonCode: 'identity_mismatch' },
      cookie: a.cookie,
    });
    expect(ok.status).toBe(200);
    expect(await db.auth.userState(p.uid)).toMatchObject({ verificationStatus: 'rejected' });
    const rows = await db
      .runner('eda_owner')
      .withUserScope({ userId: p.uid }, async (tx) =>
        tx.query<{ rejection_reason: string }>(
          'SELECT rejection_reason FROM app.lawyer_profiles WHERE user_id = $1',
          [p.uid],
        ),
      );
    expect(rows.rows[0]?.rejection_reason).toBe('identity_mismatch');
  });

  it('step-up penceresi geçince başvuru ucu 403 AUTH_STEP_UP_REQUIRED; Pano serbest', async () => {
    const a = await loggedIn('stepup-yonetici');
    const p = await pendingApplicant('stepup');
    // Oturum Valkey'de önbelleklidir: güncelleme Better Auth iç bağdaştırıcısından yapılır.
    const ctx = await identity.auth.$context;
    for (const sess of await ctx.internalAdapter.listSessions(a.uid)) {
      await ctx.internalAdapter.updateSession(sess.token, {
        stepUpAt: new Date(Date.now() - 2 * 3_600_000),
      } as never);
    }
    const w = await call(`/api/v1/admin/applications/${p.uid}/approve`, {
      body: {},
      cookie: a.cookie,
    });
    expect(w.status).toBe(403);
    expect(((await w.json()) as { error: { code: string } }).error.code).toBe(
      'AUTH_STEP_UP_REQUIRED',
    );
    // Okuma uçları `usage_read` gibi step-up istemeyen izinlerdedir.
    expect((await call('/api/v1/admin/overview', { cookie: a.cookie })).status).toBe(200);
  });

  it('support rolü Pano ve başvuru uçlarına giremez', async () => {
    const a = await loggedIn('destek', 'support');
    for (const path of ['/api/v1/admin/overview', '/api/v1/admin/applications']) {
      const r = await call(path, { cookie: a.cookie });
      expect(r.status, path).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('ADMIN_FORBIDDEN');
    }
  });
});

describe('KK-P27b-2: Pano ve istatistikler', () => {
  it('Pano sayıları içeriksizdir ve bekleyen başvuruyu yansıtır', async () => {
    const a = await loggedIn('pano');
    await pendingApplicant('pano-bekleyen');
    const r = await call('/api/v1/admin/overview', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const o = (await r.json()) as {
      applications: { pending: number; oldestPendingAt: string | null };
      verifiedUsers: number;
    };
    expect(o.applications.pending).toBeGreaterThanOrEqual(1);
    expect(o.applications.oldestPendingAt).not.toBeNull();
    // Yanıtta kullanıcı yazısı, e-posta veya ad bulunmaz.
    expect(JSON.stringify(o)).not.toContain('@');
  });

  it('Pano bekleyen sayacı yalnız gönderilmiş başvuruyu sayar ve listeyle tutarlıdır', async () => {
    const a = await loggedIn('pano-tutarli');
    const overview = async () =>
      (await (await call('/api/v1/admin/overview', { cookie: a.cookie })).json()) as {
        applications: { pending: number };
      };
    const listed = async () =>
      (await (
        await call('/api/v1/admin/applications?status=pending_verification&limit=100', {
          cookie: a.cookie,
        })
      ).json()) as { items: { userId: string }[] };
    const before = (await overview()).applications.pending;

    // (a) Meslek bilgisini göndermemiş bekleyen hesap sayılmaz.
    const bare = `profilsiz.${KEY}@${DOMAIN}`;
    const bareUid = await db.auth.insertUser({
      name: 'Başvuran profilsiz',
      email: bare,
      emailVerified: true,
      verificationStatus: 'pending_verification',
    });
    expect((await overview()).applications.pending).toBe(before);
    expect((await listed()).items.some((x) => x.userId === bareUid)).toBe(false);

    // (b) Gönderilmiş başvuru sayılır ve listede görünür.
    const p = await pendingApplicant('pano-gonderilmis');
    expect((await overview()).applications.pending).toBe(before + 1);
    expect((await listed()).items.some((x) => x.userId === p.uid)).toBe(true);

    // (c) Onaylanınca sayaç düşer.
    const ok = await call(`/api/v1/admin/applications/${p.uid}/approve`, {
      body: {},
      cookie: a.cookie,
    });
    expect(ok.status).toBe(200);
    expect((await overview()).applications.pending).toBe(before);
    expect((await listed()).items.some((x) => x.userId === p.uid)).toBe(false);
  });

  it('günlük seri, huni ve kırılım; aralık sınırı', async () => {
    const a = await loggedIn('istatistik');
    await pendingApplicant('istatistik-hesap');
    // Gün sınırı Europe/Istanbul'dur; UTC gece yarısına yakın koşularda kayma olmasın diye aralık
    // bugünün bir gün sonrasına kadar uzatılır (8 gün).
    const today = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const r = await call(`/api/v1/admin/stats?from=${from}&to=${today}`, { cookie: a.cookie });
    expect(r.status).toBe(200);
    const s = (await r.json()) as {
      daily: { day: string; signups: number }[];
      funnel: { signups: number; applications: number };
    };
    expect(s.daily).toHaveLength(8);
    expect(s.daily.reduce((n, d) => n + d.signups, 0)).toBe(s.funnel.signups);
    expect(s.funnel.applications).toBeGreaterThanOrEqual(1);
    const tooLong = await call(`/api/v1/admin/stats?from=2025-01-01&to=${today}`, {
      cookie: a.cookie,
    });
    expect(tooLong.status).toBe(422);
  });
});

describe('KK-P27a-9: güvenlik sertleştirmesi', () => {
  it('staff-reenroll açık oturumları (Valkey dahil) kapatır', async () => {
    const a = await loggedIn('reenroll');
    expect((await call('/api/v1/admin/me', { cookie: a.cookie })).status).toBe(200);
    await reenrollStaff(
      {
        db: defaultAuthDb(),
        issueEnrollmentToken: identity.issueEnrollmentToken,
        revokeAllSessions: identity.revokeAllSessions,
        adminUrl: ADMIN_URL,
      },
      { email: a.email },
    );
    expect((await call('/api/v1/admin/me', { cookie: a.cookie })).status).toBe(401);
    expect(await db.auth.passkeyCount(a.uid)).toBe(0);
  });

  it('kayıt oturumu yalnız passkey kaydı yollarını kullanabilir', async () => {
    const s = await staff('kayit-siniri');
    const start = await call('/api/auth/staff/enroll', { body: { token: s.token } });
    const cookie = cookieOf(start, ADMIN_SESSION_COOKIE) ?? '';
    expect((await call('/api/auth/passkey/list-user-passkeys', { cookie })).status).toBe(403);
    expect((await call('/api/auth/list-sessions', { cookie })).status).toBe(404);
    expect((await call('/api/auth/passkey/generate-register-options', { cookie })).status).toBe(
      200,
    );
  });

  it('step-up penceresi geçince passkey ekleme reddedilir', async () => {
    const a = await loggedIn('pk-stepup');
    const ctx = await identity.auth.$context;
    for (const sess of await ctx.internalAdapter.listSessions(a.uid)) {
      await ctx.internalAdapter.updateSession(sess.token, {
        stepUpAt: new Date(Date.now() - 2 * 3_600_000),
      } as never);
    }
    const r = await call('/api/auth/passkey/generate-register-options', { cookie: a.cookie });
    expect(r.status).toBe(403);
  });

  it('yeni passkey girişi önceki yönetim oturumunu kapatır (tek oturum)', async () => {
    const s = await staff('tek-oturum');
    const { auth } = await enroll(s.token);
    const first = cookieOf(await login(auth), ADMIN_SESSION_COOKIE) ?? '';
    const second = cookieOf(await login(auth), ADMIN_SESSION_COOKIE) ?? '';
    expect((await call('/api/v1/admin/me', { cookie: second })).status).toBe(200);
    expect((await call('/api/v1/admin/me', { cookie: first })).status).toBe(401);
  });
});

describe('Kimlik sertleştirme: D-5 kısa kimlik bilgisi penceresi, O-5 ayrı giriş kovası', () => {
  it('D-5: genel step-up penceresi içinde bile 2 dakikadan eski kanıtla passkey eklenemez', async () => {
    const a = await loggedIn('pk-kisa-pencere');
    const ctx = await identity.auth.$context;
    const setAt = async (ms: number) => {
      for (const sess of await ctx.internalAdapter.listSessions(a.uid)) {
        await ctx.internalAdapter.updateSession(sess.token, {
          stepUpAt: new Date(Date.now() - ms),
        } as never);
      }
    };
    await setAt(3 * 60_000);
    const old = await call('/api/auth/passkey/generate-register-options', { cookie: a.cookie });
    expect(old.status).toBe(403);
    expect(((await old.json()) as { code: string }).code).toBe('AUTH_STEP_UP_REQUIRED');
    // Genel pencere (10 dk) içindeki yönetim yazma ucu hâlâ çalışır; yalnız kimlik bilgisi yolları kısadır.
    expect((await call('/api/v1/admin/overview', { cookie: a.cookie })).status).toBe(200);
    await setAt(30_000);
    expect(
      (await call('/api/auth/passkey/generate-register-options', { cookie: a.cookie })).status,
    ).toBe(200);
  });

  it('O-5: giriş uçları IP başına ayrı sıkı kovada sınırlanır; get-session sayılmaz', async () => {
    const ip = freshIp();
    const limit = CONFIG_DEFAULTS['rateLimit.adminAuthPerIpPerMin'];
    expect(limit).toBeLessThan(CONFIG_DEFAULTS['rateLimit.authPerIpPerMin']);
    for (let i = 0; i < limit; i++) {
      const r = await call('/api/auth/sign-in/email', {
        body: { email: `yok${i}.${KEY}@${DOMAIN}`, password: 'Yanlis-parola-2026' },
        ip,
      });
      expect(r.status).toBe(401);
    }
    const blocked = await call('/api/auth/sign-in/email', {
      body: { email: `yok-son.${KEY}@${DOMAIN}`, password: 'Yanlis-parola-2026' },
      ip,
    });
    expect(blocked.status).toBe(429);
    // Aynı kovada passkey seçenek ucu da tükenmiştir; get-session ise sayılmaz.
    expect((await call('/api/auth/passkey/generate-authenticate-options', { ip })).status).toBe(
      429,
    );
    for (let i = 0; i < CONFIG_DEFAULTS['rateLimit.authPerIpPerMin'] + 5; i++) {
      expect((await call('/api/auth/get-session', { ip })).status).toBe(200);
    }
  });

  it('O-5: IPv6 adresleri /64 kovasını paylaşır', async () => {
    const suffix = (ipSeq % 60_000).toString(16);
    ipSeq += 1;
    const limit = CONFIG_DEFAULTS['rateLimit.adminAuthPerIpPerMin'];
    for (let i = 0; i < limit; i++) {
      const r = await call('/api/auth/sign-in/email', {
        body: { email: `v6${i}.${KEY}@${DOMAIN}`, password: 'Yanlis-parola-2026' },
        ip: `2001:db8:${suffix}:7::${(i + 1).toString(16)}`,
      });
      expect(r.status).toBe(401);
    }
    const blocked = await call('/api/auth/sign-in/email', {
      body: { email: `v6son.${KEY}@${DOMAIN}`, password: 'Yanlis-parola-2026' },
      ip: `2001:db8:${suffix}:7:ffff::1`,
    });
    expect(blocked.status).toBe(429);
  });

  it('O-5: geçersiz kayıt belirteci denemesi denetim kaydı bırakır', async () => {
    const before = await db.jobsQuery<{ n: string }>(
      "SELECT count(*) AS n FROM app.audit_log WHERE action = 'auth.login.failure' AND metadata->>'reason' = 'enroll_invalid'",
    );
    const bad = await call('/api/auth/staff/enroll', { body: { token: 'y'.repeat(43) } });
    expect(bad.status).toBe(400);
    await vi.waitFor(async () => {
      const after = await db.jobsQuery<{ n: string }>(
        "SELECT count(*) AS n FROM app.audit_log WHERE action = 'auth.login.failure' AND metadata->>'reason' = 'enroll_invalid'",
      );
      expect(Number(after[0]?.n ?? 0)).toBeGreaterThan(Number(before[0]?.n ?? 0));
    });
  });
});
