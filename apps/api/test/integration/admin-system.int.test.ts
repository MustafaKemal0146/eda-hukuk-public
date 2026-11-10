// @tk TK-04 TK-05 TK-07
// Sistem modülü (gerçek PostgreSQL + Valkey): `GET /api/v1/admin/system`.
//  KK-SISTEM-3  yetki: anonim 401, support 403, süper yönetici 200
//  KK-SISTEM-4  doğru veri: gerçek DB fonksiyonları, gerçek kuyruk sayaçları, bakım modu salt okur
//  KK-SISTEM-5  içerik sızıntısı yok; DB fonksiyonları süper yönetici olmayan aktöre kapalı
//  KK-KANARYA-1 "Kaynak durumu" kartı: beş yoklama, son kontrol, durum, son 7 gün başarı oranı (021 §7.3)
import { randomUUID } from 'node:crypto';
import { AdminSystemDto } from '@eda/contracts/api/admin-system';
import { QUEUE_NAMES } from '@eda/contracts/config/env';
import { insertCanaryRuns } from '@eda/db/canary';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createQueueStats, type QueueStats } from '../../src/admin/queue-stats.ts';
import { createAdminService } from '../../src/admin/service.ts';
import { createSystemService } from '../../src/admin/system-service.ts';
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
const CHALLENGE = '__Host-eda-admin.passkey_challenge';
// Gerçek valkey-cache yerine sabit INFO çıktısı (test yığınında ayrı cache örneği gerekmez).
const INFO =
  'used_memory:1048576\r\nmaxmemory:0\r\nkeyspace_hits:9\r\nkeyspace_misses:1\r\ndb0:keys=5,expires=5\r\n';

let db: TestingDb;
let redis: Redis;
let stats: QueueStats;
let admin: ReturnType<typeof createAdminSurface>;
let identity: ReturnType<typeof createAdminIdentity>;
let maintenance = false;
let ipSeq = Math.floor(Math.random() * 60_000);
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.29`;
};

async function call(path: string, o: { method?: string; cookie?: string } = {}): Promise<Response> {
  const headers: Record<string, string> = { origin: ADMIN_URL, 'x-forwarded-for': freshIp() };
  if (o.cookie !== undefined) headers.cookie = o.cookie;
  return admin.request(`${ADMIN_URL}${path}`, { method: o.method ?? 'GET', headers });
}

const cookieOf = (res: Response, name: string): string | null => {
  const c = res.headers.getSetCookie().find((x) => x.startsWith(`${name}=`));
  return c === undefined ? null : (c.split(';')[0] ?? null);
};
const join2 = (...parts: (string | null)[]) => parts.filter((p) => p !== null).join('; ');

async function loggedIn(tag: string, role: 'super_admin' | 'support') {
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
  const enrol = await admin.request(`${ADMIN_URL}/api/auth/staff/enroll`, {
    method: 'POST',
    headers: {
      origin: ADMIN_URL,
      'x-forwarded-for': freshIp(),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ token }),
  });
  const enrolCookie = cookieOf(enrol, ADMIN_SESSION_COOKIE) ?? '';
  const opts = await call('/api/auth/passkey/generate-register-options', { cookie: enrolCookie });
  const reg = await admin.request(`${ADMIN_URL}/api/auth/passkey/verify-registration`, {
    method: 'POST',
    headers: {
      origin: ADMIN_URL,
      'x-forwarded-for': freshIp(),
      'content-type': 'application/json',
      cookie: join2(enrolCookie, cookieOf(opts, CHALLENGE)),
    },
    body: JSON.stringify({
      response: auth.register((await opts.json()) as { challenge: string }),
    }),
  });
  expect(reg.status).toBe(200);
  const o = await call('/api/auth/passkey/generate-authenticate-options');
  const ok = await admin.request(`${ADMIN_URL}/api/auth/passkey/verify-authentication`, {
    method: 'POST',
    headers: {
      origin: ADMIN_URL,
      'x-forwarded-for': freshIp(),
      'content-type': 'application/json',
      cookie: cookieOf(o, CHALLENGE) ?? '',
    },
    body: JSON.stringify({
      response: auth.authenticate((await o.json()) as { challenge: string }),
    }),
  });
  expect(ok.status).toBe(200);
  return { uid, cookie: cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '' };
}

beforeAll(async () => {
  const pg = inject('pg');
  const v = inject('valkey');
  db = createTestingDb(pg);
  redis = createValkeyClient(v, 'eda-admin-system-it');
  await redis.connect();
  stats = createQueueStats(redis);
  const logger = createLogger({
    service: 'eda-admin-system-it',
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
  const adminDb = adminDbFromEnv();
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
      maintenanceMode: () => maintenance,
      service: createAdminService({ db: adminDb, enqueueEmailSend: async () => undefined }),
      system: createSystemService({
        db: adminDb,
        probes: [
          { name: 'postgres', hard: true, run: async () => true },
          { name: 'valkeyCache', hard: false, run: async () => false },
        ],
        maintenanceMode: () => maintenance,
        cacheInfo: async () => INFO,
        queueCounts: (q) => stats.counts(q),
      }),
    },
  );
});

afterAll(async () => {
  await stats?.close().catch(() => undefined);
  await redis?.quit().catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

describe('KK-SISTEM-3: yetki', () => {
  it('anonim 401; support 403 ADMIN_FORBIDDEN; yazma yöntemleri tanımsız', async () => {
    expect((await call('/api/v1/admin/system')).status).toBe(401);
    const s = await loggedIn('sistem-destek', 'support');
    const denied = await call('/api/v1/admin/system', { cookie: s.cookie });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe(
      'ADMIN_FORBIDDEN',
    );
    const a = await loggedIn('sistem-yazma', 'super_admin');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const r = await call('/api/v1/admin/system', { method, cookie: a.cookie });
      expect([404, 405], method).toContain(r.status);
    }
  });
});

describe('KK-SISTEM-4: doğru veri', () => {
  it('süper yönetici servis, önbellek, kuyruk ve veritabanı özetini alır', async () => {
    const a = await loggedIn('sistem-okuma', 'super_admin');
    maintenance = true;
    const r = await call('/api/v1/admin/system', { cookie: a.cookie });
    maintenance = false;
    expect(r.status, await r.clone().text()).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = AdminSystemDto.parse(await r.json());
    expect(body.maintenanceMode).toBe(true);
    expect(body.services.map((s) => [s.key, s.state])).toEqual([
      ['postgres', 'ok'],
      ['valkeyCache', 'degraded'],
    ]);
    expect(body.cache).toMatchObject({
      available: true,
      hits: 9,
      misses: 1,
      hitRate: 0.9,
      keys: 5,
    });
    expect(body.queues.available).toBe(true);
    expect(body.queues.items.map((q) => q.name)).toEqual([...QUEUE_NAMES]);
    expect(body.database.available).toBe(true);
    expect(body.database.databaseBytes).toBeGreaterThan(0);
    expect(body.database.connections.total).toBeGreaterThan(0);
    expect(body.database.connections.max).toBeGreaterThan(0);
    expect(body.database.schemas.some((s) => s.schema === 'app' && s.tables > 0)).toBe(true);
    expect(body.database.topTables.length).toBeGreaterThan(0);
    expect(body.database.topTables.length).toBeLessThanOrEqual(10);
    // Yedek kaynağı bu servise bağlı değil (API yedek deposuna erişemez): kart "veri yok" döner.
    expect(body.backup).toMatchObject({
      available: false,
      unavailableReason: 'no_source',
      lastFullAt: null,
      walLagSeconds: null,
      restoreDrillAt: null,
    });
  });
});

describe('KK-SISTEM-5: içerik yok ve fonksiyon yetkisi', () => {
  it('yanıtta e-posta, sorgu veya anahtar adı bulunmaz', async () => {
    const a = await loggedIn('sistem-sizinti', 'super_admin');
    const text = await (await call('/api/v1/admin/system', { cookie: a.cookie })).text();
    expect(text).not.toContain('@');
    expect(text.toLowerCase()).not.toContain('select ');
    expect(text).not.toContain('eda:');
  });

  it('app.admin_system_* süper yönetici olmayan aktöre 42501 verir', async () => {
    const s = await loggedIn('sistem-fn-destek', 'support');
    const adminDb = adminDbFromEnv();
    for (const fn of ['admin_system_connections', 'admin_system_sizes']) {
      await expect(
        adminDb.withAdmin((tx) => tx.query(`SELECT * FROM app.${fn}($1)`, [s.uid])),
      ).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      adminDb.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_system_sizes($1)', [randomUUID()]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('KK-KANARYA-1: Kaynak durumu kartı', () => {
  it('beş yoklama sözleşme sırasıyla; son sonuç, art arda başarısızlık ve pencere oranı; içerik yok', async () => {
    await db.ownerQuery('DELETE FROM corpus.source_canary_runs');
    const day = (d: number) => new Date(Date.now() - d * 86_400_000);
    await db.runner('eda_worker').withNoTenant('corpus', (tx) =>
      insertCanaryRuns(tx, [
        { probe: 'uyap_search', outcome: 'ok', durationMs: 900, checkedAt: day(9) },
        { probe: 'uyap_search', outcome: 'ok', durationMs: 800, checkedAt: day(3) },
        { probe: 'uyap_search', outcome: 'error', durationMs: 40, checkedAt: day(2) },
        { probe: 'uyap_search', outcome: 'timeout', durationMs: 20000, checkedAt: day(1) },
        { probe: 'mevzuat_article', outcome: 'ok', durationMs: 300, checkedAt: day(1) },
      ]),
    );
    try {
      const a = await loggedIn('sistem-kanarya', 'super_admin');
      const r = await call('/api/v1/admin/system', { cookie: a.cookie });
      expect(r.status, await r.clone().text()).toBe(200);
      const body = AdminSystemDto.parse(await r.json());
      const c = body.sourceCanary;
      expect(c).toMatchObject({ available: true, windowDays: 7, failThreshold: 2 });
      expect(c.items.map((i) => i.probe)).toEqual([
        'uyap_search',
        'anayasa_search',
        'uyusmazlik_search',
        'mevzuat_search',
        'mevzuat_article',
      ]);
      const [uyap, aym] = c.items;
      expect(uyap).toMatchObject({
        state: 'failing',
        lastOutcome: 'timeout',
        lastDurationMs: 20000,
        consecutiveFailures: 2,
        degraded: true,
        windowRuns: 3,
        windowOk: 1,
      });
      expect(uyap?.successRate).toBeCloseTo(1 / 3);
      expect(aym).toMatchObject({ state: 'unknown', lastCheckedAt: null, successRate: null });
      expect(c.items[4]).toMatchObject({ state: 'ok', degraded: false, successRate: 1 });
      const text = JSON.stringify(c);
      expect(text).not.toMatch(/kıdem|tazminat|query|sorgu/i);
    } finally {
      await db.ownerQuery('DELETE FROM corpus.source_canary_runs');
    }
  });

  it('app.admin_system_source_canary süper yönetici olmayan aktöre 42501 verir', async () => {
    const s = await loggedIn('sistem-kanarya-destek', 'support');
    await expect(
      adminDbFromEnv().withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_system_source_canary($1, 7)', [s.uid]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
