// @tk TK-04 TK-05 TK-07
// Kimlik zinciri entegrasyonu: gerçek PostgreSQL (eda_app / eda_auth / eda_readonly_admin havuzları)
// + gerçek Valkey (eda_api ACL) + Better Auth 1.7.7; `setupIdentity` + `createAppSurface` aynı
// kurucuyla (`pnpm --filter @eda/api test:int`; TEST yığını, infra/scripts/dev/test-db.sh).
// Belirteçler e-postadan değil, outbox satırındaki mühürlü parametreden (`kek_master`) açılır; Mailpit
// ayağı worker entegrasyon testindedir (KK-P04a-15). Saat yalnız `Date` sahtelenerek ilerletilir.
//  KK-P04a-1  (KK-042-1)  tüm Set-Cookie başlıkları `__Host-eda.` + Secure; HttpOnly; SameSite=Lax; Path=/.
//  KK-P04a-3  (KK-042-3)  12 sa boşta ve 30 gün mutlak süre; iptal edilen oturum reddedilir.
//  KK-P04a-4  (KK-042-4)  doğrulamadan önce oturum/büro yok; sonra bireysel büro + owner + org_settings
//                          + org_keys; idempotent; tekrar kayıt aynı yanıt + registration_attempt.
//  KK-P04a-6  (KK-042-6)  aynı (baro, sicil) 409; approve-user verified + deneme; ret sonrası bekleme.
//  KK-P04a-7  (KK-042-8)  bilinen/bilinmeyen e-posta yanıtları eşit; $argon2id$; yeniden özet.
//  KK-P04a-9  (KK-042-17) 11. istek 429; artan Retry-After; farklı IP serbest; 6. e-posta yok; 503.
//  KK-P04a-10 (KK-042-20) denetim olayları; katalog dışı olay hatası; günlükte e-posta/belirteç/parola yok.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { ApiErrorEnvelope } from '@eda/contracts/errors';
import { parseKekFile, unsealJobParams } from '@eda/crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { approveUser } from '../../src/admin/approve-user.ts';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createAppSurface } from '../../src/app.ts';
import { appendAudit } from '../../src/auth/audit.ts';
import { SESSION_COOKIE } from '../../src/auth/cookies.ts';
import { hashPassword } from '../../src/auth/password.ts';
import { closeAuthDbPool } from '../../src/auth/pool.ts';
import { createValkeyClient } from '../../src/clients/valkey.ts';
import { createReadiness } from '../../src/health/ready.ts';
import { type IdentitySetup, setupIdentity } from '../../src/identity.ts';
import { RateLimiter } from '../../src/middleware/rate-limit.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
    valkey: { url: string; username: string; passwordFile: string };
  }
}

const APP_URL = 'https://app.ornek.test';
const DOMAIN = 'ornek.test';
const PASSWORD = 'Guclu-ve-uzun-parola-2026';
const KEY = randomUUID().slice(0, 8);

let db: TestingDb;
let kek: Buffer;
let redis: Redis;
let queueRedis: Redis;
let setup: IdentitySetup;
let app: ReturnType<typeof createAppSurface>['app'];
const logLines: string[] = [];
const setCookies: string[] = [];
const secrets: string[] = [PASSWORD];
const emails: string[] = [];
// Çalıştırmalar arası Valkey'de kalan sayaçlarla çakışmasın diye rastgele başlangıç.
let ipSeq = Math.floor(Math.random() * 60_000);

/** Sahte olmayan gerçek saat (Date sahtelenmişken). */
const realNow = () => Math.floor(performance.timeOrigin + performance.now());
const advance = (ms: number) => vi.setSystemTime(new Date(Date.now() + ms));
/** Her çağrı ayrı bir /24 öneki: `auth-ip` ve hesap+IP sayaçları testler arasında karışmaz. */
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.32`;
};
const mail = (tag: string) => {
  const e = `${tag}.${KEY}@${DOMAIN}`;
  emails.push(e);
  return e;
};

interface CallOpts {
  readonly method?: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly ip?: string;
}

async function call(path: string, o: CallOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    origin: APP_URL,
    'x-forwarded-for': o.ip ?? freshIp(),
  };
  if (o.body !== undefined) headers['content-type'] = 'application/json';
  if (o.cookie !== undefined) headers.cookie = o.cookie;
  const res = await app.request(`${APP_URL}${path}`, {
    method: o.method ?? (o.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  });
  setCookies.push(...res.headers.getSetCookie());
  return res;
}

function sessionCookie(res: Response): string {
  const c = res.headers.getSetCookie().find((x) => x.startsWith(`${SESSION_COOKIE}=`));
  if (c === undefined) throw new Error('oturum çerezi yok');
  return c.split(';')[0] ?? '';
}

async function errorOf(res: Response) {
  return ApiErrorEnvelope.parse(await res.json()).error;
}

const signUp = (email: string, name = 'Örnek Avukat', ip?: string) =>
  call('/api/auth/sign-up/email', {
    body: { name, email, password: PASSWORD, acceptTerms: true, acknowledgePrivacy: true },
    ...(ip === undefined ? {} : { ip }),
  });

const signIn = (email: string, password = PASSWORD, ip?: string) =>
  call('/api/auth/sign-in/email', {
    body: { email, password },
    ...(ip === undefined ? {} : { ip }),
  });

async function userId(email: string): Promise<string> {
  const id = await db.auth.userIdByEmail(email);
  if (id === null) throw new Error('kullanıcı yok');
  return id;
}

/** Outbox satırları (eda_worker, kullanıcı bağı). */
async function deliveries(uid: string) {
  return db.runner('eda_worker').withUserScope({ userId: uid }, async (tx) => {
    const r = await tx.query<{
      id: string;
      template_code: string;
      params: unknown;
      sealed_params: Buffer | null;
    }>(
      `SELECT id, template_code, params, sealed_params FROM app.email_deliveries
       WHERE user_id = $1 ORDER BY created_at, id`,
      [uid],
    );
    return r.rows;
  });
}

/** Son `template` satırının mühürlü belirteci (worker'ın gönderimde açtığı değer). */
async function tokenFor(uid: string, template: 'verify_email' | 'password_reset'): Promise<string> {
  const row = (await deliveries(uid)).filter((d) => d.template_code === template).at(-1);
  if (row?.sealed_params == null) throw new Error(`${template} satırı yok`);
  const p = unsealJobParams(kek, { deliveryId: row.id, template, userId: uid }, row.sealed_params);
  const token = p.token ?? '';
  secrets.push(token);
  return token;
}

/** Kayıt + doğrulama; doğrulama yanıtındaki oturum çerezini döndürür. */
async function verifiedUser(tag: string, name?: string) {
  const email = mail(tag);
  expect((await signUp(email, name)).status).toBe(200);
  const uid = await userId(email);
  const token = await tokenFor(uid, 'verify_email');
  const res = await call(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
  expect(res.status).toBe(200);
  return { email, uid, cookie: sessionCookie(res) };
}

/** Olay başına satır sayısı (eda_jobs; içeriksiz kolonlar). */
async function auditCounts(): Promise<Map<string, number>> {
  const r = await db.jobsQuery<{ action: string; n: string }>(
    'SELECT action, count(*) AS n FROM app.audit_log GROUP BY action',
  );
  return new Map(r.map((x) => [x.action, Number(x.n)]));
}
let auditBefore = new Map<string, number>();

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(realNow()));
  const pg = inject('pg');
  const v = inject('valkey');
  db = createTestingDb(pg);
  auditBefore = await auditCounts();
  const kekFile = readFileSync(join(pg.secretsDir, 'kek_master'), 'utf8');
  kek = parseKekFile(kekFile).kek;
  redis = createValkeyClient(v, 'eda-api-it');
  queueRedis = createValkeyClient(v, 'eda-api-it-queue');
  await Promise.all([redis.connect(), queueRedis.connect()]);
  const logger = createLogger({
    service: 'eda-api-it',
    level: 'debug',
    destination: { write: (l) => logLines.push(l) },
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
    // Tüm dosya aynı UTC günü ortak sayaçları kullanır; günlük e-posta tavanı ayrı testte sınanır.
    emailDailyCaps: { global: 10_000_000, perIp: 10_000_000 },
  });
  const state = { draining: false };
  app = createAppSurface({
    surface: 'app',
    logger,
    state,
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 65_536,
    ready: createReadiness({ probes: [], cacheMs: 0, version: 'test', state }),
    identity: setup.surface,
  }).app;
});

afterAll(async () => {
  vi.useRealTimers();
  await setup?.producer.close().catch(() => undefined);
  await Promise.all([redis?.quit(), queueRedis?.quit()]).catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

describe('KK-P04a-4 (KK-042-4): kayıt, doğrulama ve bireysel büro', () => {
  it('doğrulamadan önce oturum ve büro yok; sonra individual büro, owner, org_settings, org_keys', async () => {
    const email = mail('kayit');
    const res = await signUp(email);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"token":null,"user":null}');
    const uid = await userId(email);
    // Doğrulanmamış hesap giriş yapamaz; oturum ve üyelik oluşmaz.
    const early = await signIn(email);
    expect(early.status).toBe(403);
    expect(early.headers.getSetCookie()).toEqual([]);
    expect(await db.auth.sessionCount(uid)).toBe(0);
    expect(await db.auth.memberships(uid)).toEqual([]);

    const token = await tokenFor(uid, 'verify_email');
    const verified = await call(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(verified.status).toBe(200);
    const cookie = sessionCookie(verified);
    expect(await db.auth.userState(uid)).toEqual({
      emailVerified: true,
      verificationStatus: 'pending_verification',
    });
    const orgs = await db.auth.memberships(uid);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ kind: 'individual', role: 'owner', status: 'active' });
    const orgId = orgs[0]?.orgId ?? '';
    const appRows = await db.runner('eda_app').withTenant({ orgId, userId: uid }, async (tx) => ({
      settings: (await tx.query('SELECT 1 FROM app.org_settings WHERE org_id = $1', [orgId]))
        .rowCount,
      keys: (
        await tx.query<{ key_version: number }>(
          'SELECT key_version FROM app.org_keys WHERE org_id = $1',
          [orgId],
        )
      ).rows,
    }));
    expect(appRows).toEqual({ settings: 1, keys: [{ key_version: 1 }] });

    const me = await call('/api/v1/me', { cookie });
    expect(me.status).toBe(200);
    expect(me.headers.get('cache-control')).toBe('no-store');
    const body = (await me.json()) as {
      user: { verificationStatus: string; emailVerified: boolean };
      activeOrg: { id: string; kind: string; role: string } | null;
    };
    expect(body.user).toMatchObject({
      verificationStatus: 'pending_verification',
      emailVerified: true,
    });
    expect(body.activeOrg).toMatchObject({ id: orgId, kind: 'individual', role: 'owner' });

    // Tekrar giriş (oturum açılışında bireysel büro adımı yeniden koşar): satır sayıları değişmez.
    expect((await signIn(email)).status).toBe(200);
    expect(await db.auth.memberships(uid)).toHaveLength(1);
    const keys = await db
      .runner('eda_app')
      .withTenant({ orgId, userId: uid }, (tx) =>
        tx.query('SELECT 1 FROM app.org_keys WHERE org_id = $1', [orgId]),
      );
    expect(keys.rowCount).toBe(1);
    const created = await db.jobsQuery(
      `SELECT 1 FROM app.audit_log WHERE action = 'org.created' AND target_id = $1`,
      [orgId],
    );
    expect(created).toHaveLength(1);
  });

  it('aynı e-postayla tekrar kayıt aynı yanıtı döner ve registration_attempt e-postası kuyruğa alınır', async () => {
    const { email, uid } = await verifiedUser('tekrar');
    const fresh = await signUp(mail('yeni'));
    const again = await signUp(email);
    expect(again.status).toBe(fresh.status);
    expect(await again.text()).toBe(await fresh.text());
    const templates = (await deliveries(uid)).map((d) => d.template_code);
    expect(templates).toContain('registration_attempt');
  });

  it('kullanılmış veya bozuk doğrulama belirteci oturum açmaz', async () => {
    const email = mail('tekkullanim');
    await signUp(email);
    const uid = await userId(email);
    const token = await tokenFor(uid, 'verify_email');
    expect((await call(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)).status).toBe(
      200,
    );
    const replay = await call(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(replay.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(
      false,
    );
    const bad = await call('/api/auth/verify-email?token=bozuk.belirtec.degeri');
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false);
  });
});

describe('KK-P04a-7 (KK-042-8): hesap varlığı sızmaz; Argon2id', () => {
  it('bilinen ve bilinmeyen e-posta için giriş ve sıfırlama yanıtları eşittir', async () => {
    const { email } = await verifiedUser('esitlik');
    const known = await signIn(email, 'yanlis-parola-12345');
    const unknown = await signIn(mail('olmayan'), 'yanlis-parola-12345');
    expect(known.status).toBe(401);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.text()).toBe(await known.text());
    const r1 = await call('/api/auth/request-password-reset', { body: { email } });
    const r2 = await call('/api/auth/request-password-reset', { body: { email: mail('yok2') } });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(r1.status);
    expect(await r2.text()).toBe(await r1.text());
  });

  it('parola özeti $argon2id$; zayıf parametreli özet başarılı girişte yeniden yazılır', async () => {
    const { uid, email } = await verifiedUser('argon');
    const read = async () => (await db.auth.credentialHash(uid)) ?? '';
    const stored = await read();
    expect(stored.startsWith('$argon2id$v=19$')).toBe(true);
    const weak = await hashPassword(PASSWORD, { memoryCost: 8192, timeCost: 1, parallelism: 1 });
    await db.auth.setCredentialHash(uid, weak);
    expect((await signIn(email)).status).toBe(200);
    const rehashed = await read();
    expect(rehashed).not.toBe(weak);
    expect(rehashed).toContain(`m=${CONFIG_DEFAULTS['auth.argon2MemoryKiB']},`);
  });

  it('parola sıfırlama: belirteç tek kullanımlık, tüm oturumlar kapanır, password_changed kuyruğa alınır', async () => {
    const { uid, email, cookie } = await verifiedUser('sifirla');
    expect((await call('/api/v1/me', { cookie })).status).toBe(200);
    expect((await call('/api/auth/request-password-reset', { body: { email } })).status).toBe(200);
    const token = await tokenFor(uid, 'password_reset');
    const newPassword = 'Yepyeni-uzun-parola-2026';
    secrets.push(newPassword);
    const reset = await call('/api/auth/reset-password', { body: { token, newPassword } });
    expect(reset.status).toBe(200);
    const replay = await call('/api/auth/reset-password', {
      body: { token, newPassword: 'Baska-uzun-parola-2026' },
    });
    expect(replay.status).toBe(400);
    expect((await call('/api/v1/me', { cookie })).status).toBe(401);
    expect((await signIn(email, newPassword)).status).toBe(200);
    expect((await deliveries(uid)).map((d) => d.template_code)).toContain('password_changed');
  });
});

describe('KK-P04a-3 (KK-042-3): oturum süreleri ve iptal', () => {
  it('12 saat boşta kalan oturum geçersizdir', async () => {
    const { cookie } = await verifiedUser('bosta');
    expect((await call('/api/v1/me', { cookie })).status).toBe(200);
    advance(CONFIG_DEFAULTS['auth.sessionIdleHours'] * 3_600_000 + 60_000);
    const res = await call('/api/v1/me', { cookie });
    expect(res.status).toBe(401);
    expect((await errorOf(res)).code).toBe('AUTH_SESSION_EXPIRED');
  });

  it('kaydırmalı yenilemeye rağmen 30 gün mutlak sürede oturum kapanır', async () => {
    const { cookie } = await verifiedUser('mutlak');
    const step = 6 * 3_600_000;
    const absolute = CONFIG_DEFAULTS['auth.sessionAbsoluteDays'] * 86_400_000;
    let elapsed = 0;
    while (elapsed + step < absolute) {
      advance(step);
      elapsed += step;
      expect((await call('/api/v1/me', { cookie })).status, `t+${elapsed / 3_600_000} sa`).toBe(
        200,
      );
    }
    advance(absolute - elapsed + 60_000);
    const res = await call('/api/v1/me', { cookie });
    expect(res.status).toBe(401);
    const err = await errorOf(res);
    expect(err.code).toBe('AUTH_SESSION_EXPIRED');
    expect(err.reason).toBe('absolute_timeout');
  });

  it('çıkış yapılan ve iptal edilen oturum bir sonraki istekte reddedilir', async () => {
    const { email, cookie: a } = await verifiedUser('iptal');
    const b = sessionCookie(await signIn(email));
    const c = sessionCookie(await signIn(email));
    expect((await call('/api/auth/sign-out', { body: {}, cookie: b })).status).toBe(200);
    expect((await call('/api/v1/me', { cookie: b })).status).toBe(401);
    expect((await call('/api/v1/me', { cookie: a })).status).toBe(200);
    const revoke = await call('/api/auth/revoke-other-sessions', { body: {}, cookie: a });
    expect(revoke.status).toBe(200);
    expect((await call('/api/v1/me', { cookie: c })).status).toBe(401);
    expect((await call('/api/v1/me', { cookie: a })).status).toBe(200);
  });
});

describe('KK-P04a-9 (KK-042-17): kimlik hız sınırları', () => {
  it('aynı IP’den 11. kimlik isteği 429 + Retry-After', async () => {
    const ip = freshIp();
    const limit = CONFIG_DEFAULTS['rateLimit.authPerIpPerMin'];
    for (let i = 0; i < limit; i++) {
      expect((await signIn(mail(`ip${i}`), 'yanlis-parola-12345', ip)).status).toBe(401);
    }
    const res = await signIn(mail('ip-son'), 'yanlis-parola-12345', ip);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('RATE_LIMITED');
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('hesap+IP eşiğinden sonra artan Retry-After (doğru parolada da); farklı IP engellenmez', async () => {
    const { email } = await verifiedUser('kademe');
    const base = `172.20.${(ipSeq % 200) + 1}`;
    ipSeq += 1;
    const threshold = CONFIG_DEFAULTS['auth.loginBackoffThreshold'];
    for (let i = 1; i <= threshold; i++) {
      expect((await signIn(email, 'yanlis-parola-12345', `${base}.${i}`)).status).toBe(401);
    }
    const first = await signIn(email, PASSWORD, `${base}.50`);
    expect(first.status).toBe(429);
    const wait1 = Number(first.headers.get('retry-after'));
    expect(wait1).toBe(CONFIG_DEFAULTS['auth.loginBackoffBaseSec']);
    // Farklı önekten aynı hesaba giriş engellenmez.
    expect((await signIn(email, PASSWORD, freshIp())).status).toBe(200);
    advance(wait1 * 1000 + 1000);
    expect((await signIn(email, 'yanlis-parola-12345', `${base}.60`)).status).toBe(401);
    const second = await signIn(email, PASSWORD, `${base}.61`);
    expect(second.status).toBe(429);
    expect(Number(second.headers.get('retry-after'))).toBeGreaterThan(wait1);
    advance(Number(second.headers.get('retry-after')) * 1000 + 1000);
    expect((await signIn(email, PASSWORD, `${base}.62`)).status).toBe(200);
  });

  it('adres başı saatlik sınırı aşan kimlik e-postası kuyruğa alınmaz; yanıt değişmez', async () => {
    const { uid, email } = await verifiedUser('eposta-siniri');
    const before = (await deliveries(uid)).length;
    const bodies: string[] = [];
    for (let i = 0; i < 6; i++) {
      advance(61_000); // dakika kovalı dedupe anahtarı her istekte yeni
      const r = await call('/api/auth/request-password-reset', { body: { email } });
      expect(r.status).toBe(200);
      bodies.push(await r.text());
    }
    expect(new Set(bodies).size).toBe(1);
    const sent = (await deliveries(uid)).length - before;
    // Kayıttaki verify_email aynı kovadan sayılır: saatlik toplam sınırı aşılmaz.
    expect(before + sent).toBe(CONFIG_DEFAULTS['rateLimit.authEmailPerAddressPerHour']);
    expect(sent).toBeLessThan(6);
  });

  it('Valkey kapalıyken auth-ip kapsamı 503 (fail-closed)', async () => {
    const v = inject('valkey');
    const dead = createValkeyClient({ ...v, url: 'redis://127.0.0.1:1' }, 'eda-api-it-dead');
    dead.on('error', () => undefined);
    const offline = setupIdentity({
      edaEnv: 'test',
      appUrl: APP_URL,
      baseURL: APP_URL,
      secret: `test-${randomUUID()}-${randomUUID()}`,
      passkeyRpId: DOMAIN,
      kekFileContent: readFileSync(join(inject('pg').secretsDir, 'kek_master'), 'utf8'),
      hmacKey: Buffer.from(randomUUID()),
      redis: dead,
      queueRedis: dead,
      logger: createLogger({ service: 'eda-api-it', destination: { write: () => undefined } }),
      rerankEnabled: false,
      maintenance: () => false,
    });
    const state = { draining: false };
    const offApp = createAppSurface({
      surface: 'app',
      logger: createLogger({ service: 'eda-api-it', destination: { write: () => undefined } }),
      state,
      maintenanceMode: () => false,
      jsonBodyMaxBytes: 65_536,
      ready: createReadiness({ probes: [], cacheMs: 0, version: 'test', state }),
      identity: offline.surface,
    }).app;
    const res = await offApp.request(`${APP_URL}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        origin: APP_URL,
        'content-type': 'application/json',
        'x-forwarded-for': freshIp(),
      },
      body: JSON.stringify({ email: mail('valkeyyok'), password: PASSWORD }),
    });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('INTERNAL_DEPENDENCY_UNAVAILABLE');
    await offline.producer.close().catch(() => undefined);
    dead.disconnect();
  });
});

describe('KK-P04a-6 (KK-042-6): meslek başvurusu, approve-user ve yeniden başvuru', () => {
  it('aynı (baro, sicil) ikinci kullanıcıda 409; onay verified + deneme; ret sonrası bekleme', async () => {
    vi.setSystemTime(new Date(realNow()));
    const sicil = `${Date.now() % 1_000_000_000}`;
    const application = {
      kind: 'lawyer',
      baro: 'Ankara Barosu',
      sicilNo: sicil,
      declareProfession: true,
    };
    const a = await verifiedUser('basvuru-a', 'Örnek Avukat A');
    const b = await verifiedUser('basvuru-b', 'Örnek Avukat B');
    const ok = await call('/api/v1/me/lawyer-application', { body: application, cookie: a.cookie });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ verificationStatus: 'pending_verification' });
    const dup = await call('/api/v1/me/lawyer-application', {
      body: application,
      cookie: b.cookie,
    });
    expect(dup.status).toBe(409);
    expect((await errorOf(dup)).reason).toBe('registry_in_use');
    expect((await deliveries(a.uid)).map((d) => d.template_code)).toContain(
      'lawyer_application_received',
    );

    // approve-user: aktör açıkça verilir (aynı TEST veritabanında başka süper yöneticiler olabilir).
    const staffEmail = mail('personel');
    await db.auth.insertUser({
      name: 'Örnek Personel',
      email: staffEmail,
      emailVerified: true,
      platformRole: 'super_admin',
      verificationStatus: 'verified',
    });
    const enqueued: string[] = [];
    const out = await approveUser(
      { db: adminDbFromEnv(), enqueueEmailSend: async (id) => void enqueued.push(id) },
      { email: a.email, as: staffEmail },
    );
    expect(out).toEqual({ userIdSuffix: a.uid.slice(-8), status: 'verified' });
    expect(enqueued).toHaveLength(1);
    const me = (await (await call('/api/v1/me', { cookie: a.cookie })).json()) as {
      user: { verificationStatus: string };
      activeOrg: {
        subscription: { planCode: string; status: string };
        credits: { balance: number };
      };
    };
    expect(me.user.verificationStatus).toBe('verified');
    expect(me.activeOrg.subscription).toMatchObject({ planCode: 'trial', status: 'trialing' });
    expect(me.activeOrg.credits.balance).toBe(CONFIG_DEFAULTS['trial.credits']);
    // Doğrulanmış kullanıcının meslek bilgisi salt okunurdur.
    const locked = await call('/api/v1/me/lawyer-application', {
      body: application,
      cookie: a.cookie,
    });
    expect(locked.status).toBe(403);

    // Ret -> bekleme süresi dolmadan yeniden başvuru 409 reapply_cooldown.
    const second = { ...application, sicilNo: `${sicil}9` };
    expect(
      (await call('/api/v1/me/lawyer-application', { body: second, cookie: b.cookie })).status,
    ).toBe(200);
    const staffId = await userId(staffEmail);
    await adminDbFromEnv().withAdminWrite((tx) =>
      tx.query('SELECT app.admin_decide_application($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)', [
        staffId,
        b.uid,
        'rejected',
        'identity_mismatch',
        7,
        30,
        '2026-10-11.1',
        '{}',
        new Date(Date.now() + 86_400_000),
      ]),
    );
    const cooldown = await call('/api/v1/me/lawyer-application', {
      body: second,
      cookie: b.cookie,
    });
    expect(cooldown.status).toBe(409);
    const err = await errorOf(cooldown);
    expect(err.reason).toBe('reapply_cooldown');
    expect(Number(err.meta?.retryAfterSec)).toBeGreaterThan(0);
    // Bekleme dolunca başvuru yeniden alınır ve durum pending_verification'a döner.
    advance(CONFIG_DEFAULTS['auth.reapplyCooldownHours'] * 3_600_000 + 60_000);
    const fresh = sessionCookie(await signIn(b.email));
    const reapply = await call('/api/v1/me/lawyer-application', { body: second, cookie: fresh });
    expect(reapply.status).toBe(200);
    expect(await reapply.json()).toMatchObject({ verificationStatus: 'pending_verification' });
  });
});

describe('KK-P04a-10 (KK-042-20): denetim olayları ve günlük gizliliği', () => {
  it('yürütülen akışlar 042 §13 olaylarını yazar', async () => {
    const after = await auditCounts();
    for (const a of [
      'auth.login.success',
      'auth.login.failure',
      'auth.logout',
      'auth.session.revoked',
      'auth.password.reset_requested',
      'auth.password.changed',
      'org.created',
      'admin.application.approved',
      'admin.application.rejected',
    ]) {
      expect(after.get(a) ?? 0, a).toBeGreaterThan(auditBefore.get(a) ?? 0);
    }
  });

  it('katalog dışı olay yazma girişimi hata verir', async () => {
    const uid = await userId(emails[0] ?? '');
    const err = await db
      .runner('eda_app')
      .withUserScope({ userId: uid }, (tx) =>
        appendAudit(
          { action: 'auth.katalog_disi' as never, targetType: 'user', targetId: uid },
          'platform',
          tx,
        ),
      )
      .catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('23514');
  });

  it('günlükte e-posta, belirteç ve parola yok; params içinde belirteç yok', async () => {
    const log = logLines.join('\n');
    expect(log.length).toBeGreaterThan(0);
    for (const e of emails) expect(log).not.toContain(e);
    for (const s of secrets) expect(log).not.toContain(s);
    const uid = await userId(emails[0] ?? '');
    for (const d of await deliveries(uid)) {
      for (const s of secrets) expect(JSON.stringify(d.params)).not.toContain(s);
    }
  });
});

describe('KK-P04a-1 (KK-042-1): çerez öznitelikleri', () => {
  it('tüm Set-Cookie başlıkları __Host-eda. + Secure; HttpOnly; SameSite=Lax; Path=/; Domain yok', () => {
    expect(setCookies.length).toBeGreaterThan(0);
    for (const c of setCookies) {
      expect(c.startsWith('__Host-eda.'), c.split('=')[0]).toBe(true);
      const attrs = c
        .split(';')
        .slice(1)
        .map((x) => x.trim().toLowerCase());
      expect(attrs).toContain('secure');
      expect(attrs).toContain('httponly');
      expect(attrs).toContain('samesite=lax');
      expect(attrs).toContain('path=/');
      expect(attrs.some((x) => x.startsWith('domain='))).toBe(false);
    }
  });
});

describe('KK-P23-6: oturum yönetimi (belirteçsiz)', () => {
  it('oturumlar belirteç olmadan listelenir; kimlikle iptal edilir; geçerli oturum korunur', async () => {
    const u = await verifiedUser('oturumlar');
    const other = sessionCookie(await signIn(u.email));
    const list = await call('/api/v1/me/sessions', { cookie: u.cookie });
    expect(list.status).toBe(200);
    const text = await list.text();
    // Better Auth belirteci asla dönmez.
    expect(text).not.toMatch(/"token"/);
    const body = JSON.parse(text) as { items: { id: string; current: boolean }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    expect(body.items.filter((s) => s.current)).toHaveLength(1);
    const current = body.items.find((s) => s.current)?.id ?? '';
    const target = body.items.find((s) => !s.current)?.id ?? '';
    expect(
      (await call(`/api/v1/me/sessions/${current}`, { method: 'DELETE', cookie: u.cookie })).status,
    ).toBe(404);
    expect(
      (await call(`/api/v1/me/sessions/${target}`, { method: 'DELETE', cookie: u.cookie })).status,
    ).toBe(204);
    expect((await call('/api/v1/me', { cookie: other })).status).toBe(401);
    expect((await call('/api/v1/me', { cookie: u.cookie })).status).toBe(200);
  });

  it('diğer oturumları kapat: yalnız geçerli oturum kalır; başkasının oturumu 404', async () => {
    const u = await verifiedUser('oturum-diger');
    const second = sessionCookie(await signIn(u.email));
    const third = sessionCookie(await signIn(u.email));
    const r = await call('/api/v1/me/sessions/revoke-others', { method: 'POST', cookie: u.cookie });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { revoked: number }).revoked).toBeGreaterThanOrEqual(2);
    for (const c of [second, third])
      expect((await call('/api/v1/me', { cookie: c })).status).toBe(401);
    const v = await verifiedUser('oturum-yabanci');
    const mine = (await (await call('/api/v1/me/sessions', { cookie: v.cookie })).json()) as {
      items: { id: string }[];
    };
    const foreign = mine.items[0]?.id ?? '';
    expect(
      (await call(`/api/v1/me/sessions/${foreign}`, { method: 'DELETE', cookie: u.cookie })).status,
    ).toBe(404);
  });

  it('Better Auth list-sessions ve revoke-session yolları kapalıdır (404)', async () => {
    const u = await verifiedUser('oturum-yol');
    expect((await call('/api/auth/list-sessions', { cookie: u.cookie })).status).toBe(404);
    expect(
      (await call('/api/auth/revoke-session', { body: { token: 'x' }, cookie: u.cookie })).status,
    ).toBe(404);
  });
});

describe('KK-P04a-9 (KK-042-17) kimlik sertleştirme: IPv6 /64, küresel hesap sayacı, e-posta tavanı, D-8', () => {
  it('IPv6 adresleri /64 kovasını paylaşır: aynı /64 içinde adres döndürmek auth-ip sınırını aşmaz', async () => {
    const suffix = (ipSeq % 60_000).toString(16);
    ipSeq += 1;
    const limit = CONFIG_DEFAULTS['rateLimit.authPerIpPerMin'];
    for (let i = 0; i < limit; i++) {
      const ip = `2001:db8:${suffix}:1::${(i + 1).toString(16)}`;
      expect((await signIn(mail(`v6-${i}`), 'yanlis-parola-12345', ip)).status).toBe(401);
    }
    const blocked = await signIn(
      mail('v6-son'),
      'yanlis-parola-12345',
      `2001:db8:${suffix}:1:aaaa::9`,
    );
    expect(blocked.status).toBe(429);
    // Başka bir /64 serbest.
    const other = await signIn(mail('v6-diger'), 'yanlis-parola-12345', `2001:db8:${suffix}:2::1`);
    expect(other.status).toBe(401);
  });

  it('dağıtık deneme (O-4): eşikten sonra yeni ağdan gelen doğru parola da bekletilir; bilinen ağ kilitlenmez', async () => {
    const { email } = await verifiedUser('kuresel');
    const known = freshIp();
    expect((await signIn(email, PASSWORD, known)).status).toBe(200);
    const threshold = CONFIG_DEFAULTS['auth.accountGlobalFailureThreshold'];
    // Her deneme ayrı /24: hesap+IP sayacı hiçbirinde eşiğe varmaz, küresel sayaç toplar.
    for (let i = 0; i < threshold; i++) {
      expect((await signIn(email, 'yanlis-parola-12345', freshIp())).status).toBe(401);
    }
    const fresh = await signIn(email, PASSWORD, freshIp());
    expect(fresh.status).toBe(429);
    expect(Number(fresh.headers.get('retry-after'))).toBeGreaterThanOrEqual(
      CONFIG_DEFAULTS['auth.loginBackoffBaseSec'],
    );
    // Kilitlenme-DoS yok: hesabın daha önce girdiği ağ önekinden giriş sürer.
    expect((await signIn(email, PASSWORD, known)).status).toBe(200);
    // Eşik aşımı denetim kaydı (kimlik açık yazılmaz).
    await vi.waitFor(async () => {
      const rows = await db.jobsQuery<{ n: string }>(
        "SELECT count(*) AS n FROM app.audit_log WHERE action = 'auth.login.failure' AND metadata->>'reason' = 'account_backoff'",
      );
      expect(Number(rows[0]?.n ?? 0)).toBeGreaterThan(0);
    });
  });

  it('IP başına günlük e-posta tavanı (O-6): aşılınca 429, e-posta kuyruğa alınmaz', async () => {
    const capped = createAppSurface({
      surface: 'app',
      logger: createLogger({ service: 'eda-api-it', destination: { write: () => undefined } }),
      state: { draining: false },
      maintenanceMode: () => false,
      jsonBodyMaxBytes: 65_536,
      ready: createReadiness({
        probes: [],
        cacheMs: 0,
        version: 'test',
        state: { draining: false },
      }),
      identity: { ...setup.surface, emailDailyCaps: { global: 10_000_000, perIp: 2 } },
    }).app;
    const ip = freshIp();
    const send = (e: string) =>
      capped.request(`${APP_URL}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: { origin: APP_URL, 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ email: e }),
      });
    expect((await send(mail('tavan-a'))).status).toBe(200);
    expect((await send(mail('tavan-b'))).status).toBe(200);
    const third = await send(mail('tavan-c'));
    expect(third.status).toBe(429);
    expect(ApiErrorEnvelope.parse(await third.json()).error.code).toBe('RATE_LIMITED');
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('küresel günlük e-posta tavanı (O-6): aşılınca kısa süre sonra deneyin (503), kayıt yapılmaz', async () => {
    // Başka dosya ve çalıştırmalarla ortak "tüm sistem" sayacına karışmamak için ayrı bir UTC günü.
    const dayOffsetMs = (400 + (ipSeq % 3000)) * 86_400_000;
    const farRate = new RateLimiter({
      redis,
      hmacKey: Buffer.from(randomUUID()),
      now: () => Date.now() + dayOffsetMs,
    });
    const capped = createAppSurface({
      surface: 'app',
      logger: createLogger({ service: 'eda-api-it', destination: { write: () => undefined } }),
      state: { draining: false },
      maintenanceMode: () => false,
      jsonBodyMaxBytes: 65_536,
      ready: createReadiness({
        probes: [],
        cacheMs: 0,
        version: 'test',
        state: { draining: false },
      }),
      identity: {
        ...setup.surface,
        rate: farRate,
        emailDailyCaps: { global: 2, perIp: 10_000_000 },
      },
    }).app;
    const reset = (e: string) =>
      capped.request(`${APP_URL}/api/auth/request-password-reset`, {
        method: 'POST',
        headers: {
          origin: APP_URL,
          'content-type': 'application/json',
          'x-forwarded-for': freshIp(),
        },
        body: JSON.stringify({ email: e }),
      });
    expect((await reset(mail('kt-a'))).status).toBe(200);
    expect((await reset(mail('kt-b'))).status).toBe(200);
    const third = await reset(mail('kt-c'));
    expect(third.status).toBe(503);
    expect(ApiErrorEnvelope.parse(await third.json()).error.code).toBe(
      'INTERNAL_DEPENDENCY_UNAVAILABLE',
    );
    expect(Number(third.headers.get('retry-after'))).toBeGreaterThan(0);
    const signup = await capped.request(`${APP_URL}/api/auth/sign-up/email`, {
      method: 'POST',
      headers: {
        origin: APP_URL,
        'content-type': 'application/json',
        'x-forwarded-for': freshIp(),
      },
      body: JSON.stringify({
        name: 'Örnek Avukat',
        email: mail('kt-kayit'),
        password: PASSWORD,
        acceptTerms: true,
        acknowledgePrivacy: true,
      }),
    });
    expect(signup.status).toBe(503);
    expect(await db.auth.userIdByEmail(emails.at(-1) ?? '')).toBeNull();
  });

  it('D-8: personel hesabı doğru parolayla uygulamada, yanlış parolayla aynı 401 yanıtını alır', async () => {
    const { email, uid } = await verifiedUser('personel-giris');
    await db.auth.setPlatformRole(uid, 'support');
    const good = await signIn(email, PASSWORD);
    const bad = await signIn(email, 'yanlis-parola-12345');
    expect(good.status).toBe(401);
    expect(bad.status).toBe(401);
    expect(await good.json()).toEqual(await bad.json());
    expect(good.headers.getSetCookie()).toEqual([]);
  });
});
