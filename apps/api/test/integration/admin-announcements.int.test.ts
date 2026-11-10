// @tk TK-04 TK-05 TK-07
// P27 yönetim paneli "Duyurular ve bildirimler" (gerçek PostgreSQL + Valkey; admin yüzeyi + app servisi).
//  KK-P27-ANN-1  yayımla/düzenle/kaldır akışı, durumlar ve denetim kaydı (içeriksiz)
//  KK-P27-ANN-2  yetki: anonim 401, support yalnız okur (yazma 403), step-up süresi geçince 403
//  KK-P27-ANN-3  doğrulama: HTML/aralık 422, biten duyuru 409, olmayan kimlik 404
//  KK-P27-ANN-4  uygulama ucu: yalnız etkin, hedef kitle (org_admins) ve zamanlanmış/biten gizli
//  KK-P27-ANN-5  bildirim özeti: tür başına gönderilen/okunan, kişi bazlı veri yok
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createAdminAnnouncementsService } from '../../src/admin/announcements-service.ts';
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
import { createAnnouncementsService } from '../../src/services/announcements/active.ts';
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
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.24`;
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
      announcements: createAdminAnnouncementsService({ db: adminDbFromEnv() }),
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

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const errorOf = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;

async function expireStepUp(uid: string) {
  const ctx = await identity.auth.$context;
  for (const sess of await ctx.internalAdapter.listSessions(uid)) {
    await ctx.internalAdapter.updateSession(sess.token, {
      stepUpAt: new Date(Date.now() - 2 * 3_600_000),
    } as never);
  }
}

async function publish(cookie: string, over: Record<string, unknown> = {}) {
  const r = await call('/api/v1/admin/announcements', {
    cookie,
    body: {
      severity: 'info',
      title: `Duyuru ${randomUUID().slice(0, 8)}`,
      body: 'Planlı bakım nedeniyle hizmet kısa süre kesilebilir.',
      ...over,
    },
  });
  return r;
}

async function listAll(cookie: string) {
  const r = await call('/api/v1/admin/announcements?limit=100', { cookie });
  expect(r.status).toBe(200);
  return (
    (await r.json()) as {
      items: {
        id: string;
        title: string;
        severity: string;
        audience: string;
        state: string;
        activeUntil: string | null;
      }[];
    }
  ).items;
}

const auditOf = (id: string) =>
  db.jobsQuery<{
    action: string;
    actor_type: string;
    actor_id: string;
    org_id: string | null;
    metadata: Record<string, unknown>;
  }>(
    'SELECT action, actor_type, actor_id, org_id, metadata FROM app.audit_log WHERE target_id = $1 ORDER BY created_at, id',
    [id],
  );

describe('KK-P27-ANN-1: yayımla, düzenle, kaldır ve denetim', () => {
  it('yayımlanan duyuru listede etkin görünür; düzenleme ve kaldırma denetim yazar (metin yok)', async () => {
    const a = await loggedIn('duyuru-yonetici');
    const created = await publish(a.cookie, {
      severity: 'warning',
      title: 'Gizli başlık denemesi',
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const row = (await listAll(a.cookie)).find((x) => x.id === id);
    expect(row).toMatchObject({ severity: 'warning', audience: 'all', state: 'active' });
    expect(row?.activeUntil).toBeNull();

    const patched = await call(`/api/v1/admin/announcements/${id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      body: { severity: 'critical', audience: 'org_admins', activeUntil: hours(2) },
    });
    expect(patched.status).toBe(200);
    expect((await listAll(a.cookie)).find((x) => x.id === id)).toMatchObject({
      severity: 'critical',
      audience: 'org_admins',
      state: 'active',
    });

    const gone = await call(`/api/v1/admin/announcements/${id}/withdraw`, {
      cookie: a.cookie,
      body: {},
    });
    expect(gone.status).toBe(200);
    expect((await listAll(a.cookie)).find((x) => x.id === id)?.state).toBe('ended');

    const audit = await auditOf(id);
    expect(audit.map((x) => x.metadata.op)).toEqual(['published', 'updated', 'withdrawn']);
    for (const x of audit) {
      expect(x).toMatchObject({
        action: 'system_setting.changed',
        actor_type: 'platform_staff',
        actor_id: a.uid,
        org_id: null,
      });
      expect(x.metadata.scope).toBe('announcement');
      // Denetim kaydı duyuru metnini taşımaz.
      expect(JSON.stringify(x.metadata)).not.toContain('Gizli başlık denemesi');
      expect(JSON.stringify(x.metadata)).not.toContain('Planlı bakım');
    }
  });

  it('zamanlanmış duyuru "scheduled" görünür; kaldırılınca "ended" olur', async () => {
    const a = await loggedIn('duyuru-zamanli');
    const r = await publish(a.cookie, { activeFrom: hours(3), activeUntil: hours(5) });
    expect(r.status).toBe(201);
    const { id } = (await r.json()) as { id: string };
    expect((await listAll(a.cookie)).find((x) => x.id === id)?.state).toBe('scheduled');
    expect(
      (await call(`/api/v1/admin/announcements/${id}/withdraw`, { cookie: a.cookie, body: {} }))
        .status,
    ).toBe(200);
    expect((await listAll(a.cookie)).find((x) => x.id === id)?.state).toBe('ended');
  });
});

describe('KK-P27-ANN-2: yetki ve step-up', () => {
  it('anonim istek 401; support listeyi okur ama yazma uçlarında 403 ADMIN_FORBIDDEN', async () => {
    expect((await call('/api/v1/admin/announcements')).status).toBe(401);
    const boss = await loggedIn('duyuru-sahip');
    const created = await publish(boss.cookie);
    const { id } = (await created.json()) as { id: string };

    const s = await loggedIn('duyuru-destek', 'support');
    expect((await listAll(s.cookie)).some((x) => x.id === id)).toBe(true);
    expect(
      (
        await call('/api/v1/admin/notifications/summary?from=2026-01-01&to=2026-01-02', {
          cookie: s.cookie,
        })
      ).status,
    ).toBe(200);

    const attempts = [
      await publish(s.cookie),
      await call(`/api/v1/admin/announcements/${id}`, {
        method: 'PATCH',
        cookie: s.cookie,
        body: { title: 'Değişti' },
      }),
      await call(`/api/v1/admin/announcements/${id}/withdraw`, { cookie: s.cookie, body: {} }),
    ];
    for (const r of attempts) {
      expect(r.status).toBe(403);
      expect(await errorOf(r)).toBe('ADMIN_FORBIDDEN');
    }
    // Hiçbiri değişiklik yapmamıştır: hâlâ etkin ve başlık aynı.
    const still = (await listAll(boss.cookie)).find((x) => x.id === id);
    expect(still?.state).toBe('active');
    expect((await auditOf(id)).map((x) => x.metadata.op)).toEqual(['published']);
  });

  it('step-up penceresi geçince yayımlama 403 AUTH_STEP_UP_REQUIRED; liste serbest', async () => {
    const a = await loggedIn('duyuru-stepup');
    await expireStepUp(a.uid);
    const r = await publish(a.cookie);
    expect(r.status).toBe(403);
    expect(await errorOf(r)).toBe('AUTH_STEP_UP_REQUIRED');
    expect((await call('/api/v1/admin/announcements', { cookie: a.cookie })).status).toBe(200);
  });
});

describe('KK-P27-ANN-3: doğrulama ve durum hataları', () => {
  it('HTML etiketi, bitiş <= başlangıç ve bilinmeyen alan 422; olmayan kimlik 404; biten duyuru 409', async () => {
    const a = await loggedIn('duyuru-dogrulama');
    for (const over of [
      { title: '<script>alert(1)</script>' },
      { body: 'Metin <b>kalın</b>' },
      { activeFrom: hours(2), activeUntil: hours(1) },
      { severity: 'urgent' },
      { html: '<p>x</p>' },
    ]) {
      const r = await publish(a.cookie, over);
      expect(r.status, JSON.stringify(over)).toBe(422);
    }
    const missing = randomUUID();
    const nf = await call(`/api/v1/admin/announcements/${missing}`, {
      method: 'PATCH',
      cookie: a.cookie,
      body: { title: 'Yok' },
    });
    expect(nf.status).toBe(404);
    expect(
      (await call('/api/v1/admin/announcements/bozuk/withdraw', { cookie: a.cookie, body: {} }))
        .status,
    ).toBe(404);

    const { id } = (await (await publish(a.cookie)).json()) as { id: string };
    await call(`/api/v1/admin/announcements/${id}/withdraw`, { cookie: a.cookie, body: {} });
    const again = await call(`/api/v1/admin/announcements/${id}/withdraw`, {
      cookie: a.cookie,
      body: {},
    });
    expect(again.status).toBe(409);
    const edit = await call(`/api/v1/admin/announcements/${id}`, {
      method: 'PATCH',
      cookie: a.cookie,
      body: { title: 'Geç kaldı' },
    });
    expect(edit.status).toBe(409);
    expect(await errorOf(edit)).toBe('VALIDATION_CONFLICT');
  });
});

describe('KK-P27-ANN-4: uygulama ucu (etkin duyurular)', () => {
  it('yalnız etkin duyurular; org_admins kitlesini yalnız owner/admin görür', async () => {
    const a = await loggedIn('duyuru-uygulama');
    const org = await db.auth.insertOrg('Örnek Duyuru Bürosu', 'firm');
    await db.auth.grantSeats(org, 5);
    const mk = async (tag: string, role: 'owner' | 'lawyer') => {
      const uid = await db.auth.insertUser({
        name: `Örnek ${tag}`,
        email: `${tag}.${KEY}@${DOMAIN}`,
        emailVerified: true,
        verificationStatus: 'verified',
      });
      await db.auth.addMember(org, uid, role);
      return uid;
    };
    const owner = await mk('dy-sahip', 'owner');
    const lawyer = await mk('dy-avukat', 'lawyer');

    const idOf = async (over: Record<string, unknown>) =>
      ((await (await publish(a.cookie, over)).json()) as { id: string }).id;
    const all = await idOf({ severity: 'critical' });
    const admins = await idOf({ audience: 'org_admins' });
    const later = await idOf({ activeFrom: hours(4), activeUntil: hours(6) });
    const ended = await idOf({});
    await call(`/api/v1/admin/announcements/${ended}/withdraw`, { cookie: a.cookie, body: {} });

    const svc = createAnnouncementsService({ db: db.runner('eda_app') });
    const forLawyer = (await svc.listActive({ orgId: org, userId: lawyer, memberRole: 'lawyer' }))
      .items;
    const forOwner = (await svc.listActive({ orgId: org, userId: owner, memberRole: 'owner' }))
      .items;
    const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
    expect(ids(forLawyer).has(all)).toBe(true);
    expect(ids(forLawyer).has(admins)).toBe(false);
    expect(ids(forOwner).has(all) && ids(forOwner).has(admins)).toBe(true);
    for (const x of [...forLawyer, ...forOwner]) {
      expect([later, ended]).not.toContain(x.id);
    }
    // Ciddiyet sırası: kritik, uyarı/bilgi önünde.
    expect(forOwner[0]?.severity).toBe('critical');
  });
});

describe('KK-P27-ANN-5: bildirim gönderim özeti', () => {
  it('tür başına gönderilen/okunan toplanır; kişi veya büro kimliği dönmez; aralık sınırı 422', async () => {
    const a = await loggedIn('duyuru-ozet');
    const today = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const summary = async () => {
      const r = await call(`/api/v1/admin/notifications/summary?from=${from}&to=${today}`, {
        cookie: a.cookie,
      });
      expect(r.status).toBe(200);
      return (await r.json()) as {
        items: { type: string; sent: number; read: number }[];
        totals: { sent: number; read: number };
      };
    };
    const pick = (s: Awaited<ReturnType<typeof summary>>, type: string) =>
      s.items.find((x) => x.type === type) ?? { sent: 0, read: 0 };
    const before = await summary();

    const org = await db.auth.insertOrg('Örnek Özet Bürosu', 'firm');
    await db.auth.grantSeats(org, 5);
    const uid = await db.auth.insertUser({
      name: 'Örnek özet',
      email: `ozet.${KEY}@${DOMAIN}`,
      emailVerified: true,
      verificationStatus: 'verified',
    });
    await db.auth.addMember(org, uid, 'lawyer');
    await db.runner('eda_worker').withTenant({ orgId: org, userId: uid }, async (tx) => {
      for (const [type, readAt] of [
        ['credit_low', 'now()'],
        ['credit_low', 'NULL'],
        ['credit_low', 'NULL'],
        ['provider_change_notice', 'now()'],
      ] as const) {
        await tx.query(
          `INSERT INTO app.notifications (org_id, user_id, type, payload, read_at)
           VALUES ($1, $2, $3, '{}'::jsonb, ${readAt})`,
          [org, uid, type],
        );
      }
    });
    const after = await summary();
    expect(pick(after, 'credit_low').sent - pick(before, 'credit_low').sent).toBe(3);
    expect(pick(after, 'credit_low').read - pick(before, 'credit_low').read).toBe(1);
    expect(
      pick(after, 'provider_change_notice').sent - pick(before, 'provider_change_notice').sent,
    ).toBe(1);
    expect(after.totals.sent - before.totals.sent).toBe(4);
    const text = JSON.stringify(after);
    expect(text).not.toContain(uid);
    expect(text).not.toContain(org);

    const tooLong = await call(`/api/v1/admin/notifications/summary?from=2025-01-01&to=${today}`, {
      cookie: a.cookie,
    });
    expect(tooLong.status).toBe(422);
  });
});
