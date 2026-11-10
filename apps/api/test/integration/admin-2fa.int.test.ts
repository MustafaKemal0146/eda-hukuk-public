// @tk TK-04 TK-05 TK-07
// Yönetim girişi: e-posta + parola + TOTP.
//  KK-P27a-10  parola+TOTP ile giriş (mfa_level=totp), platformGate geçer, tek oturum, denetim kaydı
//  KK-P27a-11  TOTP'siz / personel olmayan / askıdaki hesap yanlış parola ile aynı hatayı alır
//  KK-P27a-12  yanlış parola ve yanlış TOTP: hata sayacı, bekleme (429), tekrar kullanım reddi
//  KK-P27a-13  step-up TOTP ile (oturumlu doğrulama); passkey yolu bozulmaz
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createAdminService } from '../../src/admin/service.ts';
import { createAdminSurface } from '../../src/admin-app.ts';
import { ADMIN_SESSION_COOKIE } from '../../src/auth/admin-auth.ts';
import { createAdminIdentity } from '../../src/auth/admin-identity.ts';
import { defaultAuthDb, valkeyReplayGuard, valkeySecondaryStorage } from '../../src/auth/index.ts';
import { hashPassword } from '../../src/auth/password.ts';
import { closeAuthDbPool } from '../../src/auth/pool.ts';
import { createStaff, promoteStaff } from '../../src/auth/staff.ts';
import { createValkeyClient } from '../../src/clients/valkey.ts';
import { RateLimiter } from '../../src/middleware/rate-limit.ts';
import { softAuthenticator, totpFromUri } from './webauthn.ts';

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
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.21`;
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
    },
  );
});

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

const PASSWORD = 'Guclu-ve-uzun-parola-2026';
const TWO_FACTOR_COOKIE = '__Host-eda-admin.two_factor';
/** Boş değerli (silme amaçlı) çerezler sayılmaz. */
const liveCookie = (res: Response, name: string): string | null => {
  const c = cookieOf(res, name);
  return c === null || c.endsWith('=') ? null : c;
};
const nextCode = (uri: string) => totpFromUri(uri);

async function signIn(email: string, password: string, ip?: string) {
  const headers: Record<string, string> = {
    origin: ADMIN_URL,
    'content-type': 'application/json',
    'x-forwarded-for': ip ?? freshIp(),
  };
  return admin.request(`${ADMIN_URL}/api/auth/sign-in/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  });
}

async function verifyTotp(code: string, cookie: string, ip?: string) {
  return admin.request(`${ADMIN_URL}/api/auth/two-factor/verify-totp`, {
    method: 'POST',
    headers: {
      origin: ADMIN_URL,
      'content-type': 'application/json',
      'x-forwarded-for': ip ?? freshIp(),
      cookie,
    },
    body: JSON.stringify({ code }),
  });
}

interface TotpStaff {
  email: string;
  uid: string;
  uri: string;
}

/** Personel + parola + etkin TOTP (passkey kaydı yalnız TOTP'yi hazırlamak için kullanılır). */
async function totpStaff(tag: string, role: 'super_admin' | 'support' = 'super_admin') {
  const s = await staff(tag, role);
  const { auth } = await enroll(s.token);
  const ok = await login(auth);
  const cookie = cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '';
  await db.auth.insertCredential(s.uid, await hashPassword(PASSWORD));
  const en = await identity.auth.api.enableTwoFactor({
    headers: new Headers({ cookie }),
    body: { password: PASSWORD },
  });
  await db.auth.markTotpVerified(s.uid);
  await identity.revokeAllSessions(s.uid);
  const out: TotpStaff = {
    email: s.email,
    uid: s.uid,
    uri: en.method === 'totp' ? en.totpURI : '',
  };
  return out;
}

/** Parola + TOTP ile tam giriş; oturum çerezini döndürür. */
async function fullLogin(t: TotpStaff, code?: string) {
  const first = await signIn(t.email, PASSWORD);
  expect(first.status).toBe(200);
  const body = (await first.json()) as { twoFactorRedirect?: boolean };
  expect(body.twoFactorRedirect).toBe(true);
  expect(liveCookie(first, ADMIN_SESSION_COOKIE)).toBeNull();
  const pending = cookieOf(first, TWO_FACTOR_COOKIE) ?? '';
  const second = await verifyTotp(code ?? nextCode(t.uri), pending);
  return { first, second, cookie: cookieOf(second, ADMIN_SESSION_COOKIE) ?? '' };
}

const auditCount = async (action: string, uid: string | null, reason?: string) => {
  const r = await db.jobsQuery<{ n: string }>(
    `SELECT count(*) AS n FROM app.audit_log
      WHERE action = $1 AND ($2::uuid IS NULL OR actor_id = $2::uuid)
        AND ($3::text IS NULL OR metadata->>'reason' = $3 OR metadata->>'method' = $3)`,
    [action, uid, reason ?? null],
  );
  return Number(r[0]?.n ?? '0');
};

describe('KK-P27a-10: parola + TOTP girişi', () => {
  it('parola adımı oturum açmaz; TOTP sonrası mfa_level=totp, panel açılır, denetim yazılır', async () => {
    const t = await totpStaff('totp-giris');
    const { second, cookie } = await fullLogin(t);
    expect(second.status).toBe(200);
    expect(cookie).not.toBe('');
    const me = await call('/api/v1/admin/me', { cookie });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { platformRole: string }).platformRole).toBe('super_admin');
    expect((await db.auth.sessionRows(t.uid)).at(-1)?.mfaLevel).toBe('totp');
    expect(await auditCount('auth.login.success', t.uid, 'password_totp')).toBe(1);
  });

  it('yeni parola+TOTP girişi önceki oturumu kapatır (tek oturum)', async () => {
    const t = await totpStaff('totp-tek');
    const first = (await fullLogin(t, totpFromUri(t.uri, Date.now() - 30_000))).cookie;
    const second = (await fullLogin(t)).cookie;
    expect((await call('/api/v1/admin/me', { cookie: second })).status).toBe(200);
    expect((await call('/api/v1/admin/me', { cookie: first })).status).toBe(401);
  });

  it('support rolü parola+TOTP ile girer ama yönetici uçlarına giremez', async () => {
    const t = await totpStaff('totp-destek', 'support');
    const { cookie } = await fullLogin(t);
    expect((await call('/api/v1/admin/me', { cookie })).status).toBe(200);
    const r = await call('/api/v1/admin/overview', { cookie });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe('ADMIN_FORBIDDEN');
  });

  it('mutlak ömür ve askı: yasaklanan personelin TOTP oturumu platformGate te kapanır', async () => {
    const t = await totpStaff('totp-askida');
    const { cookie } = await fullLogin(t);
    await db.auth.setVerification(t.uid, 'suspended');
    const denied = await call('/api/v1/admin/me', { cookie });
    expect(denied.status).toBe(403);
  });

  it('oturum çerezi __Host- öneklidir, Secure/HttpOnly/SameSite=Lax, Domain yok', async () => {
    const t = await totpStaff('totp-cerez');
    const { second, first } = await fullLogin(t);
    for (const res of [first, second]) {
      for (const c of res.headers.getSetCookie()) {
        expect(c).toMatch(/^__Host-eda-admin\./);
        expect(c).toContain('Secure');
        expect(c).toContain('HttpOnly');
        expect(c).toContain('SameSite=Lax');
        expect(c).not.toContain('Domain');
      }
    }
  });
});

describe('KK-P27a-11: uygun olmayan hesap tek tip hata', () => {
  const wrong = async (email: string, password: string) => {
    const r = await signIn(email, password);
    return { status: r.status, body: await r.text(), cookies: r.headers.getSetCookie() };
  };

  it('TOTP kapalı personel, personel olmayan kullanıcı, askıdaki hesap ve yanlış parola aynı yanıtı verir', async () => {
    const hash = await hashPassword(PASSWORD);
    const mk = async (
      tag: string,
      o: { role?: 'user' | 'support' | 'super_admin'; status?: 'verified' | 'suspended' },
    ) => {
      const email = `${tag}.${KEY}@${DOMAIN}`;
      const uid = await db.auth.insertUser({
        name: `Örnek ${tag}`,
        email,
        emailVerified: true,
        platformRole: o.role ?? 'user',
        verificationStatus: o.status ?? 'verified',
      });
      await db.auth.insertCredential(uid, hash);
      return { email, uid };
    };
    const noTotp = await mk('totpsuz', { role: 'super_admin' });
    const plain = await mk('rolsuz', {});
    const susp = await mk('askida', { role: 'support', status: 'suspended' });
    const known = await totpStaff('yanlis-parola');
    const baseline = await wrong(known.email, 'Yanlis-parola-2026');
    expect(baseline.status).toBe(401);
    for (const u of [noTotp, plain, susp]) {
      const r = await wrong(u.email, PASSWORD);
      expect(r.status, u.email).toBe(baseline.status);
      expect(r.body, u.email).toBe(baseline.body);
      expect(r.cookies.some((c) => /^[^=]+=[^;]+/.test(c))).toBe(false);
    }
    const unknown = await wrong(`yok-hesap.${KEY}@${DOMAIN}`, PASSWORD);
    expect(unknown.status).toBe(baseline.status);
    expect(unknown.body).toBe(baseline.body);
    // Neden yalnız denetim kaydındadır.
    expect(await auditCount('auth.login.failure', noTotp.uid, 'totp_not_enabled')).toBe(1);
    expect(await auditCount('auth.login.failure', null, 'not_staff')).toBeGreaterThanOrEqual(1);
  });

  it('platform_role=user olan TOTP li hesap yönetimde oturum alamaz', async () => {
    const t = await totpStaff('rol-dusur');
    await db.auth.setPlatformRole(t.uid, 'user');
    const r = await signIn(t.email, PASSWORD);
    expect(r.status).toBe(401);
  });
});

describe('KK-P27a-12: brute-force', () => {
  it('ardışık yanlış parola eşikten sonra 429 + Retry-After verir; doğru parola da bekler', async () => {
    const t = await totpStaff('bf-parola');
    const ip = freshIp();
    let last = 0;
    for (let i = 0; i < 12; i += 1) {
      const r = await signIn(t.email, 'Yanlis-parola-2026', ip);
      last = r.status;
      if (r.status === 429) {
        expect(r.headers.get('retry-after')).not.toBeNull();
        break;
      }
      expect(r.status).toBe(401);
    }
    expect(last).toBe(429);
    const right = await signIn(t.email, PASSWORD, ip);
    expect(right.status).toBe(429);
    expect(await auditCount('auth.login.failure', null, 'invalid_credentials')).toBeGreaterThan(0);
  });

  it('yanlış TOTP reddedilir ve hata sayacına işler; aynı kod ikinci kez kullanılamaz', async () => {
    const t = await totpStaff('bf-totp');
    const ip = freshIp();
    const first = await signIn(t.email, PASSWORD, ip);
    const pending = cookieOf(first, TWO_FACTOR_COOKIE) ?? '';
    const bad = await verifyTotp('000000', pending, ip);
    expect(bad.status).toBe(401);
    expect(liveCookie(bad, ADMIN_SESSION_COOKIE)).toBeNull();
    expect(await auditCount('auth.login.failure', t.uid, 'totp_invalid')).toBeGreaterThanOrEqual(1);
    const code = totpFromUri(t.uri);
    const ok = await verifyTotp(code, pending, ip);
    expect(ok.status).toBe(200);
    const again = await signIn(t.email, PASSWORD, ip);
    const replay = await verifyTotp(code, cookieOf(again, TWO_FACTOR_COOKIE) ?? '', ip);
    expect(replay.status).toBe(401);
  });

  it('TOTP adımında ardışık hata hesabı bekletir (429)', async () => {
    const t = await totpStaff('bf-totp-kilit');
    const ip = freshIp();
    let got429 = false;
    for (let i = 0; i < 12 && !got429; i += 1) {
      const first = await signIn(t.email, PASSWORD, ip);
      if (first.status === 429) {
        got429 = true;
        break;
      }
      const pending = cookieOf(first, TWO_FACTOR_COOKIE) ?? '';
      const bad = await verifyTotp(String(100000 + i), pending, ip);
      if (bad.status === 429) got429 = true;
    }
    expect(got429).toBe(true);
  });
});

describe('KK-P27a-13: step-up TOTP ile; passkey yolu', () => {
  const expireStepUp = async (uid: string) => {
    const ctx = await identity.auth.$context;
    for (const sess of await ctx.internalAdapter.listSessions(uid)) {
      await ctx.internalAdapter.updateSession(sess.token, {
        stepUpAt: new Date(Date.now() - 2 * 3_600_000),
      } as never);
    }
  };

  it('pencere dolunca yazma ucu step-up ister; oturumlu TOTP penceresini yeniler', async () => {
    const t = await totpStaff('stepup-totp');
    const { cookie } = await fullLogin(t);
    await expireStepUp(t.uid);
    const p = await db.auth.insertUser({
      name: 'Başvuran stepup-totp',
      email: `basvuran-stepup.${KEY}@${DOMAIN}`,
      emailVerified: true,
    });
    const blocked = await call(`/api/v1/admin/applications/${p}/approve`, { body: {}, cookie });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe(
      'AUTH_STEP_UP_REQUIRED',
    );
    const bad = await call('/api/auth/two-factor/verify-totp', {
      body: { code: '000000' },
      cookie,
    });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const ok = await call('/api/auth/two-factor/verify-totp', {
      body: { code: totpFromUri(t.uri, Date.now() + 30_000) },
      cookie,
    });
    expect(ok.status).toBe(200);
    // Aynı oturum çerezi geçerli kalır, pencere yenilenmiştir; mfa_level düşmez.
    const me = await call('/api/v1/admin/me', { cookie });
    expect(me.status).toBe(200);
    expect(
      ((await me.json()) as { session: { stepUpValidUntil: string | null } }).session
        .stepUpValidUntil,
    ).not.toBeNull();
    expect((await db.auth.sessionRows(t.uid)).at(-1)?.mfaLevel).toBe('totp');
    expect(await auditCount('auth.step_up', t.uid, 'totp')).toBe(1);
  });

  it('oturumsuz veya TOTP siz hesapla oturumlu TOTP doğrulaması reddedilir', async () => {
    const anon = await call('/api/auth/two-factor/verify-totp', { body: { code: '123456' } });
    expect(anon.status).toBeGreaterThanOrEqual(400);
    const s = await staff('stepup-totpsuz');
    const { auth } = await enroll(s.token);
    const cookie = cookieOf(await login(auth), ADMIN_SESSION_COOKIE) ?? '';
    const r = await call('/api/auth/two-factor/verify-totp', { body: { code: '123456' }, cookie });
    expect(r.status).toBe(403);
  });

  it('passkey yolu bozulmaz: passkey girişi mfa_level=passkey verir', async () => {
    const s = await staff('pk-regresyon');
    const { auth } = await enroll(s.token);
    const ok = await login(auth);
    expect(ok.status).toBe(200);
    expect((await db.auth.sessionRows(s.uid)).at(-1)?.mfaLevel).toBe('passkey');
  });
});

describe('KK-P27a-14: staff-promote', () => {
  const run = (email: string, role: string) =>
    promoteStaff(
      {
        db: defaultAuthDb(),
        revokeAllSessions: identity.revokeAllSessions,
        audit: async (e) => {
          const { withNoTenant } = await import('@eda/db');
          const { appendAudit } = await import('../../src/auth/audit.ts');
          await withNoTenant('pre_auth_audit', (tx) => appendAudit(e, 'platform', tx));
        },
      },
      { email, role },
    );

  it('TOTP li doğrulanmış kullanıcıyı yükseltir, oturumları kapatır, denetim yazar; sonra parola+TOTP ile girilir', async () => {
    const t = await totpStaff('promote-ok');
    await db.auth.setPlatformRole(t.uid, 'user');
    const r = await run(t.email, 'super_admin');
    expect(r.unchanged).toBe(false);
    expect((await run(t.email, 'super_admin')).unchanged).toBe(true);
    const { second, cookie } = await fullLogin(t);
    expect(second.status).toBe(200);
    expect((await call('/api/v1/admin/me', { cookie })).status).toBe(200);
    const n = await db.jobsQuery<{ n: string }>(
      `SELECT count(*) AS n FROM app.audit_log
        WHERE action = 'system_setting.changed' AND target_id = $1 AND metadata->>'setting' = 'platform_role'`,
      [t.uid],
    );
    expect(Number(n[0]?.n ?? '0')).toBe(1);
  });

  it('TOTP siz, doğrulanmamış, yasaklı veya bulunamayan hesapta net Türkçe hata verir', async () => {
    const mk = async (
      tag: string,
      o: { verified?: boolean; status?: 'verified' | 'suspended' },
    ) => {
      const email = `${tag}.${KEY}@${DOMAIN}`;
      const uid = await db.auth.insertUser({
        name: `Örnek ${tag}`,
        email,
        emailVerified: o.verified ?? true,
        verificationStatus: o.status ?? 'verified',
      });
      return { email, uid };
    };
    const noTotp = await mk('pr-totpsuz', {});
    await expect(run(noTotp.email, 'support')).rejects.toThrow('2 adımlı doğrulama');
    expect(await db.auth.userState(noTotp.uid)).not.toBeNull();
    const unv = await mk('pr-dogrulanmamis', { verified: false });
    await expect(run(unv.email, 'support')).rejects.toThrow('doğrulanmamış');
    await expect(run(`yok.${KEY}@${DOMAIN}`, 'support')).rejects.toThrow('bulunamadı');
    await expect(run(noTotp.email, 'owner')).rejects.toThrow('rol');
    const t = await totpStaff('pr-askida');
    await db.auth.setPlatformRole(t.uid, 'user');
    await db.auth.setVerification(t.uid, 'suspended');
    await expect(run(t.email, 'support')).rejects.toThrow('askıda');
  });
});
