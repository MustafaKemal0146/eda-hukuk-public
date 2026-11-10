// @tk TK-04 TK-05 TK-07
// Yönetim "Kullanım ve limitler" modülü (gerçek PostgreSQL + Valkey + Better Auth).
//  KK-USAGE-1  yetki: anonim 401, support 403, step-up penceresi geçince yazma 403
//  KK-USAGE-2  kullanım: token/maliyet/çağrı toplamları, model takma adı dağılımı, en çok kullanan 10 büro,
//              büro süzgeci, aralık sınırı; yanıtta kullanıcı veya e-posta yok
//  KK-USAGE-3  limit: platform varsayılanları görünür; büro geçersiz kılma yaz/oku/kaldır; denetim satırı
//              (içeriksiz); kapalı anahtar kümesi ve değer doğrulaması
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

const ADMIN_URL = 'https://admin.kullanim.test';
const DOMAIN = 'kullanim.test';
const KEY = randomUUID().slice(0, 8);
const CHALLENGE = '__Host-eda-admin.passkey_challenge';

let db: TestingDb;
let redis: Redis;
let admin: ReturnType<typeof createAdminSurface>;
let identity: ReturnType<typeof createAdminIdentity>;
let ipSeq = Math.floor(Math.random() * 60_000);
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.30`;
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
  const cookie = cookieOf(start, ADMIN_SESSION_COOKIE) ?? '';
  const opts = await call('/api/auth/passkey/generate-register-options', { cookie });
  const reg = await call('/api/auth/passkey/verify-registration', {
    body: { response: auth.register((await opts.json()) as { challenge: string }) },
    cookie: join2(cookie, cookieOf(opts, CHALLENGE)),
  });
  expect(reg.status).toBe(200);
  const o = await call('/api/auth/passkey/generate-authenticate-options');
  const ok = await call('/api/auth/passkey/verify-authentication', {
    body: {
      response: auth.authenticate((await o.json()) as { challenge: string }),
    },
    cookie: cookieOf(o, CHALLENGE) ?? '',
  });
  expect(ok.status).toBe(200);
  return { email, uid, cookie: cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '' };
}

/** Büro + üye + sentetik kullanım satırları (içerik yok; yalnız sayaç). */
async function orgWithUsage(
  tag: string,
  rows: { alias: string; inTok: number; outTok: number; cost: number; status?: string }[],
) {
  const email = `${tag}.${KEY}@${DOMAIN}`;
  const uid = await db.auth.insertUser({
    name: `Üye ${tag}`,
    email,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  const org = await db.auth.insertOrg(`Büro ${tag} ${KEY}`, 'firm');
  await db.auth.addMember(org, uid, 'owner');
  await db.runner('eda_app').withTenant({ orgId: org, userId: uid }, async (tx) => {
    for (const r of rows) {
      await tx.query(
        `INSERT INTO app.ai_usage (org_id, user_id, task, model_alias, provider_id, model_id, region,
           data_class, thinking, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens,
           pricing_window, cost_micro_usd, status)
         VALUES ($1, $2, 'chat', $3, 'mock', 'mock-1', 'NONE', 'public', 'off', $4, $5, $6, $7, 'flat', $8, $9)`,
        [
          org,
          uid,
          r.alias,
          r.inTok,
          Math.floor(r.inTok / 2),
          r.outTok,
          Math.floor(r.outTok / 4),
          r.cost,
          r.status ?? 'success',
        ],
      );
    }
  });
  return { org, uid, email };
}

const range = () => {
  const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
};

beforeAll(async () => {
  const pg = inject('pg');
  const v = inject('valkey');
  db = createTestingDb(pg);
  redis = createValkeyClient(v, 'eda-admin-usage-it');
  await redis.connect();
  const logger = createLogger({
    service: 'eda-admin-usage-it',
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
    },
  );
});

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

describe('KK-USAGE-1: kullanım ve limit uçları yetkisi', () => {
  it('oturumsuz 401; support 403 (okuma ve yazma)', async () => {
    const q = range();
    for (const path of [`/api/v1/admin/usage?from=${q.from}&to=${q.to}`, '/api/v1/admin/limits']) {
      expect((await call(path)).status, path).toBe(401);
    }
    const s = await loggedIn('destek', 'support');
    const org = await orgWithUsage('destek-buro', []);
    for (const path of [`/api/v1/admin/usage?from=${q.from}&to=${q.to}`, '/api/v1/admin/limits']) {
      const r = await call(path, { cookie: s.cookie });
      expect(r.status, path).toBe(403);
      expect(((await r.json()) as { error: { code: string } }).error.code).toBe('ADMIN_FORBIDDEN');
    }
    const put = await call(`/api/v1/admin/limits/orgs/${org.org}/files.orgMaxConcurrentJobs`, {
      method: 'PUT',
      body: { value: 3 },
      cookie: s.cookie,
    });
    expect(put.status).toBe(403);
    const del = await call(`/api/v1/admin/limits/orgs/${org.org}/files.orgMaxConcurrentJobs`, {
      method: 'DELETE',
      cookie: s.cookie,
    });
    expect(del.status).toBe(403);
  });

  it('step-up penceresi geçince yazma 403 AUTH_STEP_UP_REQUIRED; okuma serbest ve kayıt yazılmaz', async () => {
    const a = await loggedIn('stepup');
    const o = await orgWithUsage('stepup-buro', []);
    const ctx = await identity.auth.$context;
    for (const sess of await ctx.internalAdapter.listSessions(a.uid)) {
      await ctx.internalAdapter.updateSession(sess.token, {
        stepUpAt: new Date(Date.now() - 2 * 3_600_000),
      } as never);
    }
    const w = await call(`/api/v1/admin/limits/orgs/${o.org}/kvkk.searchPerOrgPerHour`, {
      method: 'PUT',
      body: { value: 5 },
      cookie: a.cookie,
    });
    expect(w.status).toBe(403);
    expect(((await w.json()) as { error: { code: string } }).error.code).toBe(
      'AUTH_STEP_UP_REQUIRED',
    );
    expect((await call('/api/v1/admin/limits', { cookie: a.cookie })).status).toBe(200);
    const rows = await db.jobsQuery('SELECT 1 FROM app.org_limit_overrides WHERE org_id = $1', [
      o.org,
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe('KK-USAGE-2: kullanım özeti', () => {
  it('toplamlar, model dağılımı, en çok kullanan büro ve büro süzgeci doğru; yanıt içeriksiz', async () => {
    const a = await loggedIn('kullanim');
    const o = await orgWithUsage('kullanim-buro', [
      { alias: 'edai-flash', inTok: 1000, outTok: 200, cost: 5_000_000_000 },
      { alias: 'edai-flash', inTok: 500, outTok: 100, cost: 1_000_000_000, status: 'error' },
      { alias: 'edai-pro', inTok: 2000, outTok: 800, cost: 4_000_000_000 },
    ]);
    const q = range();
    const filtered = await call(`/api/v1/admin/usage?from=${q.from}&to=${q.to}&orgId=${o.org}`, {
      cookie: a.cookie,
    });
    expect(filtered.status).toBe(200);
    const f = (await filtered.json()) as {
      totals: Record<string, number>;
      daily: { day: string; calls: number }[];
      monthly: { month: string; calls: number }[];
      models: { modelAlias: string; calls: number; costMicroUsd: number }[];
      topOrgs: unknown[];
    };
    expect(f.totals).toMatchObject({
      calls: 3,
      errors: 1,
      inputTokens: 3500,
      outputTokens: 1100,
      cachedInputTokens: 1750,
      reasoningTokens: 275,
      costMicroUsd: 10_000_000_000,
    });
    expect(f.daily).toHaveLength(8);
    expect(f.daily.reduce((n, d) => n + d.calls, 0)).toBe(3);
    expect(f.monthly.reduce((n, m) => n + m.calls, 0)).toBe(3);
    expect(f.models.map((m) => m.modelAlias).sort()).toEqual(['edai-flash', 'edai-pro']);
    expect(f.models.find((m) => m.modelAlias === 'edai-pro')).toMatchObject({
      calls: 1,
      costMicroUsd: 4_000_000_000,
    });
    expect(f.topOrgs).toEqual([]);

    const all = await call(`/api/v1/admin/usage?from=${q.from}&to=${q.to}`, { cookie: a.cookie });
    expect(all.status).toBe(200);
    const text = await all.text();
    const p = JSON.parse(text) as {
      topOrgs: { orgId: string; costMicroUsd: number; orgLabel: string }[];
      totals: { costMicroUsd: number };
    };
    expect(p.topOrgs.length).toBeLessThanOrEqual(10);
    expect(p.topOrgs.find((x) => x.orgId === o.org)).toMatchObject({
      costMicroUsd: 10_000_000_000,
    });
    expect(p.totals.costMicroUsd).toBeGreaterThanOrEqual(10_000_000_000);
    // Kişi bazlı veya içerik alanı yok: kullanıcı kimliği, e-posta ve ad sızmaz.
    expect(text).not.toContain(o.uid);
    expect(text).not.toContain(o.email);
    expect(text).not.toContain('@');
    expect(text).not.toMatch(/user_?id|userId/);
  });

  it('aralık sınırı ve geçersiz sorgu 422', async () => {
    const a = await loggedIn('aralik');
    const q = range();
    for (const path of [
      `/api/v1/admin/usage?from=2025-01-01&to=${q.to}`,
      `/api/v1/admin/usage?from=${q.to}&to=${q.from}`,
      `/api/v1/admin/usage?from=${q.from}&to=${q.to}&orgId=degil`,
      '/api/v1/admin/usage',
    ]) {
      expect((await call(path, { cookie: a.cookie })).status, path).toBe(422);
    }
  });
});

describe('KK-USAGE-3: limit görünümü ve büro geçersiz kılma', () => {
  it('platform varsayılanları görünür; yalnız büro anahtarları geçersiz kılınabilir', async () => {
    const a = await loggedIn('limit-gorunum');
    const r = await call('/api/v1/admin/limits', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      items: { key: string; defaultValue: unknown; source: string; orgOverridable: boolean }[];
      overridableKeys: string[];
    };
    const keys = body.items.map((i) => i.key);
    expect(keys).toContain('chat.maxStepsPerTurn');
    expect(keys).toContain('costGuard.platformDailyCapMicroUsd');
    expect(keys).not.toContain('auth.adminSessionAbsoluteHours');
    expect(body.items.find((i) => i.key === 'chat.maxStepsPerTurn')).toMatchObject({
      defaultValue: 4,
      orgOverridable: false,
    });
    expect(body.overridableKeys).toContain('costGuard.orgDailyCapPerSeatMicroUsd');
    expect(body.items.find((i) => i.key === 'files.orgMaxConcurrentJobs')?.orgOverridable).toBe(
      true,
    );
  });

  it('yaz, oku, güncelle, kaldır; her değişiklik denetim satırı bırakır', async () => {
    const a = await loggedIn('limit-yaz');
    const o = await orgWithUsage('limit-buro', []);
    const key = 'sources.orgLivePerMin';
    const path = `/api/v1/admin/limits/orgs/${o.org}/${key}`;

    const set = await call(path, { method: 'PUT', body: { value: 7 }, cookie: a.cookie });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ orgId: o.org, key, value: 7, previousValue: null });

    const upd = await call(path, { method: 'PUT', body: { value: 9 }, cookie: a.cookie });
    expect(upd.status).toBe(200);
    expect(await upd.json()).toMatchObject({ value: 9, previousValue: 7 });

    const list = (await (await call('/api/v1/admin/limits', { cookie: a.cookie })).json()) as {
      overrides: { orgId: string; key: string; value: number; orgLabel: string }[];
    };
    expect(list.overrides.find((x) => x.orgId === o.org && x.key === key)).toMatchObject({
      value: 9,
    });

    const stored = await db.jobsQuery<{ org_id: string; key: string }>(
      'SELECT org_id, key FROM app.org_limit_overrides WHERE org_id = $1',
      [o.org],
    );
    expect(stored).toEqual([{ org_id: o.org, key }]);

    const audit = await db.jobsQuery<{
      action: string;
      actor_id: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT action, actor_id, metadata FROM app.audit_log
       WHERE target_type = 'org_limit' AND target_id = $1 ORDER BY created_at, id`,
      [o.org],
    );
    expect(audit.map((x) => x.action)).toEqual([
      'system_setting.changed',
      'system_setting.changed',
    ]);
    expect(audit.every((x) => x.actor_id === a.uid)).toBe(true);
    expect(audit[1]?.metadata).toEqual({ scope: 'org', key, from: 7, to: 9 });
    // Denetim metni içeriksizdir: yalnız anahtar ve sayılar.
    expect(JSON.stringify(audit)).not.toContain(o.email);

    const del = await call(path, { method: 'DELETE', cookie: a.cookie });
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ orgId: o.org, key, value: null, previousValue: 9 });
    expect((await call(path, { method: 'DELETE', cookie: a.cookie })).status).toBe(404);
    const after = await db.jobsQuery('SELECT 1 FROM app.org_limit_overrides WHERE org_id = $1', [
      o.org,
    ]);
    expect(after).toHaveLength(0);
    const audit2 = await db.jobsQuery<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM app.audit_log WHERE target_type = 'org_limit' AND target_id = $1
       ORDER BY created_at, id`,
      [o.org],
    );
    expect(audit2).toHaveLength(3);
    expect(audit2[2]?.metadata).toEqual({ scope: 'org', key, from: 9, to: null });
  });

  it('kapalı anahtar kümesi, değer doğrulaması ve bilinmeyen büro', async () => {
    const a = await loggedIn('limit-dogrula');
    const o = await orgWithUsage('limit-dogrula-buro', []);
    const base = `/api/v1/admin/limits/orgs/${o.org}`;
    // Kullanıcı kapsamlı veya platform anahtarı büro bazında yazılamaz (parametre doğrulaması 404).
    for (const key of ['chat.maxStepsPerTurn', 'costGuard.killSwitch', 'x.y']) {
      const r = await call(`${base}/${key}`, {
        method: 'PUT',
        body: { value: 3 },
        cookie: a.cookie,
      });
      expect(r.status, key).toBe(404);
    }
    for (const body of [
      { value: 0 },
      { value: -1 },
      { value: 1.5 },
      { value: '3' },
      {},
      { value: 3, x: 1 },
    ]) {
      const r = await call(`${base}/files.orgMaxConcurrentJobs`, {
        method: 'PUT',
        body,
        cookie: a.cookie,
      });
      expect(r.status, JSON.stringify(body)).toBe(422);
    }
    const unknownOrg = await call(
      `/api/v1/admin/limits/orgs/${randomUUID()}/files.orgMaxConcurrentJobs`,
      { method: 'PUT', body: { value: 3 }, cookie: a.cookie },
    );
    expect(unknownOrg.status).toBe(404);
    const none = await db.jobsQuery('SELECT 1 FROM app.org_limit_overrides WHERE org_id = $1', [
      o.org,
    ]);
    expect(none).toHaveLength(0);
  });
});
