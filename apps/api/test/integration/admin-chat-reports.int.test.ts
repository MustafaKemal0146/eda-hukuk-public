// @tk TK-04 TK-05 TK-07
// P27 "Sohbetler ve raporlar" (gerçek PostgreSQL + Valkey + Better Auth; yönetim yüzeyi).
//  KK-P27-chat-1  yetki: anonim 401, support 403, süper yönetici 200; aralık sınırı; indirme/ek parametre yok
//  KK-P27-chat-2  doğru toplulaştırma (sohbet, mesaj, tur, araç, kaynak, geri bildirim)
//  KK-P27-chat-3  GİZLİLİK: sentetik sohbet içeriği, kullanıcı ve büro kimliği yanıtta/fonksiyon çıktısında ASLA geçmez
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
  return `10.${(Math.floor(ipSeq / 250) % 250) + 1}.${ipSeq % 250}.27`;
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

async function loggedIn(tag: string, role: 'super_admin' | 'support' = 'super_admin') {
  const s = await staff(tag, role);
  const { auth } = await enroll(s.token);
  const ok = await login(auth);
  expect(ok.status).toBe(200);
  return { ...s, cookie: cookieOf(ok, ADMIN_SESSION_COOKIE) ?? '' };
}

const MARKER = `GIZLI-ISARET-${randomUUID()}`;

interface Report {
  daily: { conversations: number; messages: number; turns: number; turnErrors: number }[];
  modes: { mode: string; calls: number }[];
  aliases: { alias: string; turns: number }[];
  tools: { tool: string; calls: number; errors: number; avgDurationMs: number }[];
  sources: { kind: string; count: number }[];
  feedback: { up: number; down: number; downCategories: { category: string; count: number }[] };
}

const range = () => {
  const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  return `from=${from}&to=${to}`;
};
const sum = (r: Report, k: 'conversations' | 'messages' | 'turns' | 'turnErrors') =>
  r.daily.reduce((n, d) => n + d[k], 0);
const toolOf = (r: Report, name: string) => r.tools.find((t) => t.tool === name);

async function fetchReport(cookie: string): Promise<{ text: string; json: Report }> {
  const res = await call(`/api/v1/admin/chat-reports?${range()}`, { cookie });
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('no-store');
  const text = await res.text();
  return { text, json: JSON.parse(text) as Report };
}

/** Sentetik sohbet: içerik kolonlarının hepsine benzersiz işaret yazılır. */
async function seedChat(tag = '') {
  const email = `sohbet.${KEY}${tag}@${DOMAIN}`;
  const uid = await db.auth.insertUser({
    name: `Kullanici ${MARKER}`,
    email,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  const org = await db.auth.insertOrg(`Buro ${MARKER}`, 'firm');
  await db.auth.addMember(org, uid, 'owner');
  const ids = await db.runner('eda_owner').withTenant({ orgId: org, userId: uid }, async (tx) => {
    const conv = await tx.query<{ id: string }>(
      `INSERT INTO app.conversations (org_id, user_id, title, title_fold, summary)
       VALUES ($1, $2, $3, $3, $3) RETURNING id`,
      [org, uid, MARKER],
    );
    const conversationId = conv.rows[0]?.id ?? '';
    await tx.query(
      `INSERT INTO app.messages (org_id, conversation_id, role, user_id, parts, llm_context)
       VALUES ($1, $2, 'user', $3, $4::jsonb, $5)`,
      [org, conversationId, uid, JSON.stringify([{ type: 'text', text: MARKER }]), MARKER],
    );
    const a1 = await tx.query<{ id: string }>(
      `INSERT INTO app.messages (org_id, conversation_id, role, status, parts, llm_parts, reasoning,
                                 model_alias, created_at, completed_at)
       VALUES ($1, $2, 'assistant', 'complete', $3::jsonb, $4::json, $4::json, 'edai-flash',
               now() - interval '4 seconds', now()) RETURNING id`,
      [
        org,
        conversationId,
        JSON.stringify([{ type: 'text', text: MARKER }]),
        JSON.stringify({ gizli: MARKER }),
      ],
    );
    const messageId = a1.rows[0]?.id ?? '';
    await tx.query(
      `INSERT INTO app.messages (org_id, conversation_id, role, status, parts, model_alias, in_transcript)
       VALUES ($1, $2, 'assistant', 'error', $3::jsonb, 'edai-pro', false)`,
      [org, conversationId, JSON.stringify([{ type: 'text', text: MARKER }])],
    );
    for (const [status, ms] of [
      ['success', 100],
      ['success', 300],
      ['error', 50],
    ] as const) {
      await tx.query(
        `INSERT INTO app.tool_calls (org_id, conversation_id, message_id, tool_name, status, duration_ms)
         VALUES ($1, $2, $3, 'search_decisions', $4, $5)`,
        [org, conversationId, messageId, status, ms],
      );
    }
    await tx.query(
      `INSERT INTO app.message_sources (org_id, conversation_id, message_id, ref_no, source_kind, origin,
                                        source_key, kunye_snapshot)
       VALUES ($1, $2, $3, 1, 'decision', 'corpus', 'k-1', $4::jsonb)`,
      [org, conversationId, messageId, JSON.stringify({ kunye: MARKER })],
    );
    await tx.query(
      `INSERT INTO app.message_feedback (org_id, message_id, user_id, rating, category)
       VALUES ($1, $2, $3, -1, 'incorrect')`,
      [org, messageId, uid],
    );
    await tx.query(
      `INSERT INTO app.ai_usage (org_id, user_id, conversation_id, message_id, task, model_alias,
                                 provider_id, model_id, region, data_class, thinking, pricing_window, status)
       VALUES ($1, $2, $3, $4, 'chat', 'edai-flash', 'mock', 'mock-model', 'NONE', 'client', 'off', 'flat', 'success')`,
      [org, uid, conversationId, messageId],
    );
    return { conversationId, messageId };
  });
  return { uid, org, ...ids };
}

describe('KK-P27-chat-1: yetki, aralık ve dışa aktarma yokluğu', () => {
  it('anonim 401, support 403, süper yönetici 200', async () => {
    expect((await call(`/api/v1/admin/chat-reports?${range()}`)).status).toBe(401);
    const sup = await loggedIn('chat-destek', 'support');
    const denied = await call(`/api/v1/admin/chat-reports?${range()}`, { cookie: sup.cookie });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { error: { code: string } }).error.code).toBe(
      'ADMIN_FORBIDDEN',
    );
    const a = await loggedIn('chat-yonetici');
    expect((await call(`/api/v1/admin/chat-reports?${range()}`, { cookie: a.cookie })).status).toBe(
      200,
    );
  });

  it('92 günü aşan aralık ve ek parametre (ör. csv) reddedilir; indirme ucu yok', async () => {
    const a = await loggedIn('chat-aralik');
    const today = new Date().toISOString().slice(0, 10);
    const long = await call(`/api/v1/admin/chat-reports?from=2025-01-01&to=${today}`, {
      cookie: a.cookie,
    });
    expect(long.status).toBe(422);
    const extra = await call(`/api/v1/admin/chat-reports?${range()}&format=csv`, {
      cookie: a.cookie,
    });
    expect(extra.status).toBeGreaterThanOrEqual(400);
    for (const p of ['/api/v1/admin/chat-reports.csv', '/api/v1/admin/chat-reports/export']) {
      expect((await call(p, { cookie: a.cookie })).status, p).toBe(404);
    }
  });
});

describe('KK-P27-chat-2/3: toplulaştırma ve içerik sızıntısı yok', () => {
  it('sayılar doğru artar; yanıtta işaret, kullanıcı ve büro kimliği geçmez', async () => {
    const a = await loggedIn('chat-rapor');
    const before = await fetchReport(a.cookie);
    const seeded = await seedChat();
    const after = await fetchReport(a.cookie);

    expect(sum(after.json, 'conversations') - sum(before.json, 'conversations')).toBe(1);
    expect(sum(after.json, 'messages') - sum(before.json, 'messages')).toBe(3);
    expect(sum(after.json, 'turns') - sum(before.json, 'turns')).toBe(2);
    expect(sum(after.json, 'turnErrors') - sum(before.json, 'turnErrors')).toBe(1);
    const tool = toolOf(after.json, 'search_decisions');
    expect((tool?.calls ?? 0) - (toolOf(before.json, 'search_decisions')?.calls ?? 0)).toBe(3);
    expect((tool?.errors ?? 0) - (toolOf(before.json, 'search_decisions')?.errors ?? 0)).toBe(1);
    const dec = (r: Report) => r.sources.find((s) => s.kind === 'decision')?.count ?? 0;
    expect(dec(after.json) - dec(before.json)).toBe(1);
    expect(after.json.feedback.down - before.json.feedback.down).toBe(1);
    const inc = (r: Report) =>
      r.feedback.downCategories.find((c) => c.category === 'incorrect')?.count ?? 0;
    expect(inc(after.json) - inc(before.json)).toBe(1);
    const chat = (r: Report) => r.modes.find((m) => m.mode === 'chat')?.calls ?? 0;
    expect(chat(after.json) - chat(before.json)).toBe(1);
    const flash = (r: Report) => r.aliases.find((x) => x.alias === 'edai-flash')?.turns ?? 0;
    expect(flash(after.json) - flash(before.json)).toBe(1);

    // GİZLİLİK: içerik işareti, kullanıcı/büro/sohbet/mesaj kimliği ve e-posta yanıtta yok.
    for (const secret of [
      MARKER,
      'GIZLI-ISARET',
      seeded.uid,
      seeded.org,
      seeded.conversationId,
      seeded.messageId,
      `sohbet.${KEY}@`,
    ]) {
      expect(after.text, secret).not.toContain(secret);
    }
    expect(after.text).not.toMatch(/"(userId|orgId|title|parts|text|summary|email)"/);
  });

  it('SQL fonksiyonlarının ham çıktısı da işaret ve kimlik taşımaz; aktör doğrulaması çalışır', async () => {
    const a = await loggedIn('chat-fonksiyon');
    const seeded = await seedChat('.fonksiyon');
    const t = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const f = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    const db2 = adminDbFromEnv();
    const raw = await db2.withAdmin(async (tx) => {
      const d = await tx.query('SELECT * FROM app.admin_chat_report_daily($1, $2, $3)', [
        a.uid,
        f,
        t,
      ]);
      const b = await tx.query('SELECT * FROM app.admin_chat_report_breakdown($1, $2, $3)', [
        a.uid,
        f,
        t,
      ]);
      return JSON.stringify([d.rows, b.rows]);
    });
    for (const secret of [
      MARKER,
      seeded.uid,
      seeded.org,
      seeded.conversationId,
      seeded.messageId,
    ]) {
      expect(raw, secret).not.toContain(secret);
    }
    // Personel olmayan aktör (sohbeti oluşturan kullanıcı) 42501 alır.
    const err = await db2
      .withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_chat_report_daily($1, $2, $3)', [seeded.uid, f, t]),
      )
      .catch((e: unknown) => e);
    expect((err as { code?: string }).code).toBe('42501');
  });
});
