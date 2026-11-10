// @tk TK-04 TK-05 TK-07
// Yönetim paneli Şablonlar, Destek ve Veri seti modülleri (gerçek PostgreSQL + Valkey + Better Auth).
//  KK-ADM-SBL-1  şablon envanteri: e-posta değişkenleri, mühürlü sır işareti, belge içeriği gizli
//  KK-ADM-SBL-2  önizleme sentetik düz metindir (HTML, belirteç, gerçek adres yok); bilinmeyen kod 404
//  KK-ADM-DST-1  destek iş listesi ve talep kuyruğu içeriksizdir (konu/gövde sızmaz)
//  KK-ADM-DST-2  durum değişikliği yalnız super_admin + step-up; denetim satırı yazılır; çakışma 409
//  KK-ADM-VRS-1  veri seti kaynak durumu: sayılar, hata kodu; karar künyesi sızmaz
//  KK-ADM-YTK-1  anonim 401; support okuma serbest, yazma 403
import { randomUUID } from 'node:crypto';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { createLogger } from '@eda/observability/logger';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import { createAdminService } from '../../src/admin/service.ts';
import { createStaffModules } from '../../src/admin/staff-modules.ts';
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
const SECRET_SUBJECT = `GIZLI-KONU-${KEY}`;
const SECRET_BODY = `GIZLI-GOVDE-${KEY}`;
const SECRET_KUNYE = `GIZLI-KUNYE-${KEY}`;

let db: TestingDb;
let redis: Redis;
let admin: ReturnType<typeof createAdminSurface>;
let identity: ReturnType<typeof createAdminIdentity>;
let ipSeq = Math.floor(Math.random() * 60_000);
const freshIp = () => {
  ipSeq += 1;
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.28`;
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
  return { uid, email, cookie: cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '' };
}

async function expireStepUp(uid: string): Promise<void> {
  const ctx = await identity.auth.$context;
  for (const sess of await ctx.internalAdapter.listSessions(uid)) {
    await ctx.internalAdapter.updateSession(sess.token, {
      stepUpAt: new Date(Date.now() - 2 * 3_600_000),
    } as never);
  }
}

/** Destek talebi: konu ve gövde panelde ASLA görünmemelidir. */
async function insertTicket(tag: string): Promise<{ ticketId: string; orgId: string }> {
  const uid = await db.auth.insertUser({
    name: `Talep eden ${tag}`,
    email: `talep.${tag}.${KEY}@${DOMAIN}`,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  const orgId = await db.auth.insertOrg(`Bireysel ${tag}`, 'individual');
  await db.auth.addMember(orgId, uid, 'owner');
  const r = await db.runner('eda_owner').withTenant({ orgId, userId: uid }, (tx) =>
    tx.query<{ id: string }>(
      `INSERT INTO app.support_tickets (org_id, user_id, category, subject, body, priority)
         VALUES ($1, $2, 'technical', $3, $4, 'urgent') RETURNING id`,
      [orgId, uid, SECRET_SUBJECT, SECRET_BODY],
    ),
  );
  return { ticketId: r.rows[0]?.id ?? '', orgId };
}

beforeAll(async () => {
  const pg = inject('pg');
  const v = inject('valkey');
  db = createTestingDb(pg);
  redis = createValkeyClient(v, 'eda-admin-staff-it');
  await redis.connect();
  const logger = createLogger({
    service: 'eda-admin-staff-it',
    level: 'error',
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
      staffModules: createStaffModules({ db: adminDbFromEnv() }),
    },
  );
});

afterAll(async () => {
  await redis?.quit().catch(() => undefined);
  await closeAuthDbPool().catch(() => undefined);
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

describe('KK-ADM-YTK-1: yetki', () => {
  it('oturumsuz istek üç modülde de 401', async () => {
    for (const path of [
      '/api/v1/admin/templates',
      '/api/v1/admin/templates/email/verify_email/preview',
      '/api/v1/admin/support/overview',
      '/api/v1/admin/support/tickets',
      '/api/v1/admin/datasets',
    ]) {
      expect((await call(path)).status, path).toBe(401);
    }
    const w = await call(`/api/v1/admin/support/tickets/${randomUUID()}/status`, {
      body: { status: 'closed' },
    });
    expect(w.status).toBe(401);
  });

  it('support okuyabilir; durum değiştiremez (ADMIN_FORBIDDEN)', async () => {
    const s = await loggedIn('yetki-destek', 'support');
    for (const path of [
      '/api/v1/admin/templates',
      '/api/v1/admin/support/overview',
      '/api/v1/admin/support/tickets',
      '/api/v1/admin/datasets',
    ]) {
      expect((await call(path, { cookie: s.cookie })).status, path).toBe(200);
    }
    const t = await insertTicket('support-yazma');
    const w = await call(`/api/v1/admin/support/tickets/${t.ticketId}/status`, {
      body: { status: 'closed' },
      cookie: s.cookie,
    });
    expect(w.status).toBe(403);
    expect(((await w.json()) as { error: { code: string } }).error.code).toBe('ADMIN_FORBIDDEN');
    const rows = await db.jobsQuery<{ status: string }>(
      'SELECT status FROM app.support_tickets WHERE id = $1',
      [t.ticketId],
    );
    expect(rows[0]?.status).toBe('open');
  });
});

describe('KK-ADM-SBL-1/2: şablonlar', () => {
  it('envanter e-posta değişkenlerini ve mühürlü sırrı işaretler; belge içeriği gizlidir', async () => {
    const a = await loggedIn('sablon-liste');
    const r = await call('/api/v1/admin/templates', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const body = (await r.json()) as {
      documentContentHidden: boolean;
      items: {
        key: string;
        type: string;
        version: string;
        implemented: boolean;
        previewable: boolean;
        variables: { name: string; sealed: boolean; type: string }[];
      }[];
    };
    expect(body.documentContentHidden).toBe(true);
    const verify = body.items.find((i) => i.key === 'verify_email');
    expect(verify).toMatchObject({ type: 'email', implemented: true, previewable: true });
    expect(verify?.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(verify?.variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'expiresInMin', type: 'number', sealed: false }),
        expect.objectContaining({ name: 'token', sealed: true }),
      ]),
    );
    // Katalogda uygulanmamış kanonik kod "planlanmış" görünür ve önizlenemez.
    const planned = body.items.filter((i) => i.type === 'email' && !i.implemented);
    for (const p of planned) expect(p.previewable).toBe(false);
  });

  it('önizleme sentetik düz metindir; HTML ve gerçek belirteç yok; bilinmeyen kod 404', async () => {
    const a = await loggedIn('sablon-onizleme');
    const r = await call('/api/v1/admin/templates/email/invitation/preview', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const p = (await r.json()) as {
      synthetic: boolean;
      subject: string;
      text: string;
      version: string;
    };
    expect(p.synthetic).toBe(true);
    expect(p.subject.length).toBeGreaterThan(0);
    expect(p.text).toContain('Örnek Hukuk Bürosu');
    expect(p.text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(p.text).not.toContain(a.email);
    expect(p.text).not.toContain('@');
    for (const bad of ['yok_boyle_sablon', 'Verify-Email', 'x'.repeat(100)]) {
      const nf = await call(`/api/v1/admin/templates/email/${bad}/preview`, { cookie: a.cookie });
      expect(nf.status, bad).toBe(404);
    }
  });
});

describe('KK-ADM-DST-1/2: destek', () => {
  it('iş listesi bekleyen başvuru, askıdaki hesap ve doğrulanmamış e-postayı içeriksiz toplar', async () => {
    const a = await loggedIn('destek-liste');
    const pendingEmail = `bekleyen.${KEY}@${DOMAIN}`;
    const unverifiedEmail = `dogrulanmamis.${KEY}@${DOMAIN}`;
    const suspendedEmail = `askida.${KEY}@${DOMAIN}`;
    await db.auth.insertUser({
      name: 'Bekleyen',
      email: pendingEmail,
      emailVerified: true,
      verificationStatus: 'pending_verification',
    });
    await db.auth.insertUser({
      name: 'Doğrulanmamış',
      email: unverifiedEmail,
      emailVerified: false,
      verificationStatus: 'pending_verification',
    });
    await db.auth.insertUser({
      name: 'Askıda',
      email: suspendedEmail,
      emailVerified: true,
      verificationStatus: 'suspended',
    });
    const r = await call('/api/v1/admin/support/overview', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const o = (await r.json()) as {
      counts: {
        pendingApplications: number;
        suspendedUsers: number;
        unverifiedEmails: number;
        tickets: { open: number };
      };
      items: { kind: string; partyEmail: string }[];
    };
    expect(o.counts.pendingApplications).toBeGreaterThanOrEqual(2);
    expect(o.counts.suspendedUsers).toBeGreaterThanOrEqual(1);
    expect(o.counts.unverifiedEmails).toBeGreaterThanOrEqual(1);
    expect(o.items.length).toBeLessThanOrEqual(30);
    // Her tür en eski 10 satırla sınırlıdır; sayaçlar ise tam toplamdır.
    for (const kind of ['pending_application', 'suspended_user', 'unverified_email']) {
      expect(o.items.filter((i) => i.kind === kind).length).toBeLessThanOrEqual(10);
    }
    expect(JSON.stringify(o)).not.toContain(SECRET_SUBJECT);
  });

  it('talep kuyruğu meta veri döndürür; konu ve gövde hiçbir yanıtta yok', async () => {
    const a = await loggedIn('destek-kuyruk');
    const t = await insertTicket('kuyruk');
    const r = await call('/api/v1/admin/support/tickets?status=open&limit=100', {
      cookie: a.cookie,
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    const body = JSON.parse(text) as {
      contentHidden: boolean;
      items: { ticketId: string; category: string; priority: string; status: string }[];
    };
    expect(body.contentHidden).toBe(true);
    const row = body.items.find((i) => i.ticketId === t.ticketId);
    expect(row).toMatchObject({ category: 'technical', priority: 'urgent', status: 'open' });
    expect(text).not.toContain(SECRET_SUBJECT);
    expect(text).not.toContain(SECRET_BODY);
    expect(
      (await call('/api/v1/admin/support/tickets?status=gecersiz', { cookie: a.cookie })).status,
    ).toBe(422);
  });

  it('durum değişikliği: step-up ister, denetim yazar, çakışmada 409, olmayan talepte 404', async () => {
    const a = await loggedIn('destek-yazma');
    const t = await insertTicket('yazma');
    const path = `/api/v1/admin/support/tickets/${t.ticketId}/status`;

    expect((await call(path, { body: { status: 'durum_yok' }, cookie: a.cookie })).status).toBe(
      422,
    );

    await expireStepUp(a.uid);
    const noStep = await call(path, { body: { status: 'in_progress' }, cookie: a.cookie });
    expect(noStep.status).toBe(403);
    expect(((await noStep.json()) as { error: { code: string } }).error.code).toBe(
      'AUTH_STEP_UP_REQUIRED',
    );

    // Yeniden giriş step-up penceresini tazeler (yeni passkey oturumu).
    const b = await loggedIn('destek-yazma-2');
    const ok = await call(path, { body: { status: 'in_progress' }, cookie: b.cookie });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ticketId: t.ticketId, status: 'in_progress' });
    const row = await db.jobsQuery<{ status: string; closed_at: Date | null }>(
      'SELECT status, closed_at FROM app.support_tickets WHERE id = $1',
      [t.ticketId],
    );
    expect(row[0]?.status).toBe('in_progress');
    expect(row[0]?.closed_at).toBeNull();

    const audit = await db.jobsQuery<{
      actor_id: string;
      actor_type: string;
      target_type: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT actor_id, actor_type, target_type, metadata FROM app.audit_log
        WHERE target_id = $1 AND target_type = 'support_ticket'`,
      [t.ticketId],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_id: b.uid,
      actor_type: 'platform_staff',
      metadata: { from: 'open', to: 'in_progress' },
    });
    // Denetim kaydı içerik taşımaz.
    expect(JSON.stringify(audit)).not.toContain(SECRET_SUBJECT);
    expect(JSON.stringify(audit)).not.toContain(SECRET_BODY);

    const same = await call(path, { body: { status: 'in_progress' }, cookie: b.cookie });
    expect(same.status).toBe(409);

    const closed = await call(path, { body: { status: 'closed' }, cookie: b.cookie });
    expect(closed.status).toBe(200);
    const after = await db.jobsQuery<{ closed_at: Date | null }>(
      'SELECT closed_at FROM app.support_tickets WHERE id = $1',
      [t.ticketId],
    );
    expect(after[0]?.closed_at).not.toBeNull();

    const missing = await call(`/api/v1/admin/support/tickets/${randomUUID()}/status`, {
      body: { status: 'closed' },
      cookie: b.cookie,
    });
    expect(missing.status).toBe(404);
    const badId = await call('/api/v1/admin/support/tickets/degil-uuid/status', {
      body: { status: 'closed' },
      cookie: b.cookie,
    });
    expect(badId.status).toBe(404);
  });
});

describe('KK-ADM-VRS-1: veri seti', () => {
  it('kaynak başına sayı ve hata kodu döner; karar künyesi sızmaz', async () => {
    const a = await loggedIn('veri-seti');
    await db.ownerQuery(
      `INSERT INTO corpus.source_status (source, live_enabled, state, breaker_state, last_error_at, last_error_code)
       VALUES ('sayistay', false, 'down', 'open', now(), 'upstream_timeout')
       ON CONFLICT (source) DO UPDATE SET state = 'down', breaker_state = 'open',
         last_error_at = now(), last_error_code = 'upstream_timeout'`,
    );
    await db.ownerQuery(
      `INSERT INTO corpus.decisions (source, document_id, origin, court_name, court_type, kunye_norm, kunye_fold, retrieved_at)
       VALUES ('sayistay', $1, 'corpus', 'Örnek Mahkeme', 'kyb', $2, $2, now())`,
      [`doc-${KEY}`, SECRET_KUNYE],
    );
    const r = await call('/api/v1/admin/datasets', { cookie: a.cookie });
    expect(r.status).toBe(200);
    const text = await r.text();
    const body = JSON.parse(text) as {
      sources: {
        source: string;
        decisionCount: number;
        corpusCount: number;
        hasError: boolean;
        state: string | null;
        breakerState: string | null;
        lastErrorCode: string | null;
      }[];
      legislation: unknown[];
      runs: unknown[];
    };
    const s = body.sources.find((x) => x.source === 'sayistay');
    expect(s).toMatchObject({
      state: 'down',
      breakerState: 'open',
      hasError: true,
      lastErrorCode: 'upstream_timeout',
    });
    expect(s?.decisionCount).toBeGreaterThanOrEqual(1);
    expect(s?.corpusCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.legislation)).toBe(true);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(text).not.toContain(SECRET_KUNYE);
    expect(text).not.toContain('Örnek Mahkeme');
  });
});
