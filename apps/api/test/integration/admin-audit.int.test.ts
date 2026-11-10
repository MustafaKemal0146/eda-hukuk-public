// @tk TK-04 TK-05 TK-07
// Denetim modülü (gerçek PostgreSQL + Valkey): denetim günlüğü görüntüleyici ve hata özeti.
//  KK-AUDIT-1  yetki: anonim 401, support ve super_admin 200; geçersiz filtre 422
//  KK-AUDIT-2  yönetim işlemi (başvuru kararı) günlükte görünür; filtre ve imleç sayfalama
//  KK-AUDIT-3  meta veri beyaz listesi: serbest metin, e-posta ve katalog dışı anahtar sızmaz
//  KK-AUDIT-4  hata özeti: ai_usage hataları ve giriş başarısızlıkları günlük + tür olarak sayılır
//  KK-GIRIS-2  yönetim girişi sayaçları: yalnız admin yüzeyi sayılır, kilitlenme ayrı, IP/e-posta yok
//  KK-AUDIT-5  step-up gerekliliği izin tablosundaki metaya bağlıdır (audit_read: yok)
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAdminAuditService } from '../../src/admin/audit-service.ts';
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
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.25`;
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
      audit: createAdminAuditService({ db: adminDbFromEnv() }),
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

const today = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const weekAgo = () => new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
const range = () => `from=${weekAgo()}&to=${today()}`;

interface EventsBody {
  items: {
    id: string;
    at: string;
    action: string;
    actorType: string;
    actorId: string | null;
    targetId: string | null;
    metadata: Record<string, string | number | boolean>;
  }[];
  nextCursor: string | null;
}

/** Platform zincirine olay yazar (tek yazma yolu `app.audit_append`; aktör oturum kapsamından). */
async function appendAudit(
  userId: string,
  action: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  await db.runner('eda_app').withUserScope({ userId }, async (tx) => {
    await tx.query(
      `SELECT app.audit_append($1, 'platform', 'system_setting', $2, $3::jsonb, NULL)`,
      [action, targetId, JSON.stringify(metadata)],
    );
  });
}

describe('KK-AUDIT-1: yetki', () => {
  it('anonim 401; super_admin ve support 200; geçersiz filtre 422', async () => {
    expect((await call('/api/v1/admin/audit/events')).status).toBe(401);
    expect((await call(`/api/v1/admin/audit/errors?${range()}`)).status).toBe(401);
    const sa = await loggedIn('denetim-sa');
    const sup = await loggedIn('denetim-destek', 'support');
    for (const a of [sa, sup]) {
      expect((await call('/api/v1/admin/audit/events', { cookie: a.cookie })).status).toBe(200);
      expect(
        (await call(`/api/v1/admin/audit/errors?${range()}`, { cookie: a.cookie })).status,
      ).toBe(200);
    }
    for (const q of [
      'action=uydurma.olay',
      'actorType=robot',
      'limit=1000',
      `from=${weekAgo()}`,
      'from=2025-01-01&to=2026-12-31',
      'cursor=bozuk',
    ]) {
      const r = await call(`/api/v1/admin/audit/events?${q}`, { cookie: sa.cookie });
      expect(r.status, q).toBe(422);
    }
  });
});

describe('KK-AUDIT-5: step-up izin tablosundan gelir', () => {
  it('audit_read step-up istemez: eski step-up penceresiyle de okunur', async () => {
    const { PERMISSIONS } = await import('@eda/contracts/permissions');
    expect(PERMISSIONS['platform:audit_read'].stepUp).toBe(false);
    expect([...PERMISSIONS['platform:audit_read'].roles].sort()).toEqual([
      'super_admin',
      'support',
    ]);
    const a = await loggedIn('denetim-stepup');
    const ctx = await identity.auth.$context;
    for (const sess of await ctx.internalAdapter.listSessions(a.uid)) {
      await ctx.internalAdapter.updateSession(sess.token, {
        stepUpAt: new Date(Date.now() - 2 * 3_600_000),
      } as never);
    }
    expect((await call('/api/v1/admin/audit/events', { cookie: a.cookie })).status).toBe(200);
  });
});

describe('KK-AUDIT-2: yönetim işlemleri, filtre ve sayfalama', () => {
  it('başvuru kararı günlükte görünür; olay türü ve aktör türü filtresi çalışır', async () => {
    const a = await loggedIn('denetim-karar');
    const p = await pendingApplicant('denetim-karar-basvuru');
    expect(
      (
        await call(`/api/v1/admin/applications/${p.uid}/reject`, {
          body: { reasonCode: 'identity_mismatch' },
          cookie: a.cookie,
        })
      ).status,
    ).toBe(200);
    const r = await call(
      `/api/v1/admin/audit/events?action=admin.application.rejected&actorType=platform_staff&${range()}`,
      { cookie: a.cookie },
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as EventsBody;
    const hit = body.items.find((x) => x.targetId === p.uid);
    expect(hit).toBeDefined();
    expect(hit?.actorId).toBe(a.uid);
    expect(hit?.actorType).toBe('platform_staff');
    expect(hit?.metadata).toEqual({ reasonCode: 'identity_mismatch' });
    expect(body.items.every((x) => x.action === 'admin.application.rejected')).toBe(true);
    // Başka olay türü bu kaydı döndürmez.
    const other = (await (
      await call(`/api/v1/admin/audit/events?action=admin.application.approved&${range()}`, {
        cookie: a.cookie,
      })
    ).json()) as EventsBody;
    expect(other.items.some((x) => x.targetId === p.uid)).toBe(false);
  });

  it('imleçle sayfalama: sayfalar çakışmaz, yeniden eskiye sıralı', async () => {
    const a = await loggedIn('denetim-sayfa');
    for (let i = 0; i < 5; i += 1) {
      await appendAudit(a.uid, 'system_setting.changed', `sayfa-${KEY}-${i}`, { code: `k${i}` });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const q: string = `/api/v1/admin/audit/events?action=system_setting.changed&limit=2&${range()}${
        cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
      }`;
      const res = await call(q, { cookie: a.cookie });
      expect(res.status).toBe(200);
      const b = (await res.json()) as EventsBody;
      expect(b.items.length).toBeLessThanOrEqual(2);
      seen.push(...b.items.map((x) => x.id));
      cursor = b.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 50);
    expect(new Set(seen).size).toBe(seen.length);
    const mine = seen.length;
    expect(mine).toBeGreaterThanOrEqual(5);
    expect(pages).toBeGreaterThanOrEqual(3);
    // Zaman sırası: ilk sayfanın en yeni olayı son sayfadakinden eski olamaz.
    const all = (await (
      await call(`/api/v1/admin/audit/events?action=system_setting.changed&limit=100&${range()}`, {
        cookie: a.cookie,
      })
    ).json()) as EventsBody;
    const times = all.items.map((x) => Date.parse(x.at));
    expect([...times].sort((x, y) => y - x)).toEqual(times);
  });
});

describe('KK-AUDIT-3: meta veri beyaz listesi', () => {
  it('serbest metin, e-posta, iç içe nesne ve katalog dışı anahtar yanıta girmez', async () => {
    const a = await loggedIn('denetim-meta');
    const secretMail = `gizli.${KEY}@ornek.test`;
    await appendAudit(a.uid, 'feature_flag.changed', `meta-${KEY}`, {
      code: 'maintenance_mode',
      oldValue: 'off',
      newValue: 'on',
      count: 3,
      status: true,
      email: secretMail,
      note: 'müvekkil Ayşe Yılmaz dosyası hakkında serbest metin',
      reasonCode: 'serbest metin boşluklu',
      scope: { icerik: 'x' },
      query: 'esas no 2024/123',
    });
    const r = await call(`/api/v1/admin/audit/events?action=feature_flag.changed&${range()}`, {
      cookie: a.cookie,
    });
    const raw = await r.text();
    const body = JSON.parse(raw) as EventsBody;
    const hit = body.items.find((x) => x.targetId === `meta-${KEY}`);
    expect(hit?.metadata).toEqual({
      code: 'maintenance_mode',
      oldValue: 'off',
      newValue: 'on',
      count: 3,
      status: true,
    });
    for (const leak of [secretMail, 'Ayşe', 'serbest metin', 'esas no', 'ip_trunc', 'request_id']) {
      expect(raw, leak).not.toContain(leak);
    }
  });
});

describe('KK-AUDIT-4: hata özeti', () => {
  it('giriş başarısızlıkları ve ai_usage hataları günlük sayılır; içerik ve kişi bilgisi yok', async () => {
    const a = await loggedIn('denetim-hata');
    const before = (await (
      await call(`/api/v1/admin/audit/errors?${range()}`, { cookie: a.cookie })
    ).json()) as { totals: { aiUsage: number; authFailure: number; emailDelivery: number } };
    await appendAudit(a.uid, 'auth.login.failure', `giris-${KEY}`, {});
    await appendAudit(a.uid, 'auth.login.failure', `giris2-${KEY}`, {});
    const p = await pendingApplicant('denetim-hata-ai');
    await db.runner('eda_app').withTenant({ orgId: p.org, userId: p.uid }, async (tx) => {
      for (const [status, code] of [
        ['error', 'PROVIDER_TIMEOUT'],
        ['error', 'PROVIDER_TIMEOUT'],
        ['timeout', null],
        ['success', null],
      ] as const) {
        await tx.query(
          `INSERT INTO app.ai_usage (org_id, user_id, task, model_alias, provider_id, model_id, region,
             data_class, thinking, pricing_window, status, error_code)
           VALUES ($1, $2, 'chat', 'edai-flash', 'mock', 'mock-1', 'NONE', 'public', 'off', 'flat', $3, $4)`,
          [p.org, p.uid, status, code],
        );
      }
    });
    const r = await call(`/api/v1/admin/audit/errors?${range()}`, { cookie: a.cookie });
    expect(r.status).toBe(200);
    const raw = await r.text();
    const s = JSON.parse(raw) as {
      daily: { day: string; aiUsage: number; authFailure: number }[];
      top: { source: string; key: string; count: number }[];
      totals: { aiUsage: number; authFailure: number; emailDelivery: number };
    };
    expect(s.daily).toHaveLength(8);
    expect(s.totals.authFailure - before.totals.authFailure).toBe(2);
    expect(s.totals.aiUsage - before.totals.aiUsage).toBe(3);
    expect(s.daily.reduce((n, d) => n + d.aiUsage, 0)).toBe(s.totals.aiUsage);
    expect(s.top.some((t) => t.source === 'ai_usage' && t.key === 'error:PROVIDER_TIMEOUT')).toBe(
      true,
    );
    expect(s.top.some((t) => t.source === 'auth_failure' && t.key === 'auth.login.failure')).toBe(
      true,
    );
    expect(raw).not.toContain('@');
    const tooLong = await call('/api/v1/admin/audit/errors?from=2025-01-01&to=2026-12-31', {
      cookie: a.cookie,
    });
    expect(tooLong.status).toBe(422);
  });
});

describe('KK-GIRIS-2: yönetim girişi sayaçları (login-failures)', () => {
  const URL = '/api/v1/admin/audit/login-failures';
  type Counts = {
    failures24h: number;
    failures7d: number;
    lockouts24h: number;
    byReason: { key: string; count: number }[];
  };

  it('anonim 401; support ve super_admin 200; yanıt no-store ve içeriksiz', async () => {
    expect((await call(URL)).status).toBe(401);
    for (const [tag, role] of [
      ['giris-sa', 'super_admin'],
      ['giris-destek', 'support'],
    ] as const) {
      const a = await loggedIn(tag, role);
      const r = await call(URL, { cookie: a.cookie });
      expect(r.status, tag).toBe(200);
      expect(r.headers.get('cache-control')).toContain('no-store');
    }
  });

  it('yalnız surface=admin olaylar sayılır; backoff kilitlenme sayılır; sızıntı yok', async () => {
    const a = await loggedIn('giris-say');
    const read = async (): Promise<{ raw: string; c: Counts }> => {
      const raw = await (await call(URL, { cookie: a.cookie })).text();
      return { raw, c: JSON.parse(raw) as Counts };
    };
    const before = (await read()).c;
    const fail = (reason: string, surface: string) =>
      appendAudit(a.uid, 'auth.login.failure', `g-${KEY}`, { reason, surface });
    await fail('invalid_credentials', 'admin');
    await fail('invalid_credentials', 'admin');
    await fail('backoff', 'admin');
    await fail('invalid_credentials', 'app');
    await appendAudit(a.uid, 'auth.login.failure', `g2-${KEY}`, { reason: 'passkey' });
    const { raw, c } = await read();
    expect(c.failures24h - before.failures24h).toBe(3);
    expect(c.failures7d - before.failures7d).toBe(3);
    expect(c.lockouts24h - before.lockouts24h).toBe(1);
    const count = (x: Counts, k: string) => x.byReason.find((r) => r.key === k)?.count ?? 0;
    expect(count(c, 'invalid_credentials') - count(before, 'invalid_credentials')).toBe(2);
    expect(count(c, 'backoff') - count(before, 'backoff')).toBe(1);
    expect(raw).not.toContain('@');
    expect(raw).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    expect(raw).not.toContain(a.uid);
    expect(raw).not.toContain(KEY);
  });

  it('app.admin_audit_login_failures personel olmayan aktöre 42501 verir', async () => {
    await expect(
      adminDbFromEnv().withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_audit_login_failures($1)', [randomUUID()]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
