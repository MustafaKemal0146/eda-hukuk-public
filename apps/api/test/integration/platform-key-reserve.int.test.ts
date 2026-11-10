// @tk TK-28
//  platform ortak anahtarı: ATOMİK kota rezervasyonu (gerçek PostgreSQL; 0050). Eşzamanlı turlar
// günlük kullanıcı/büro sınırını aşamaz; hata ile biten tur iade edilir; gün sınırı Europe/Istanbul;
// kapanış hatası kotayı bozmaz. Veriler sentetiktir.
//  KK-kota-1  N paralel tur: tam limit kadar başarılı, fazlası 429 (QUOTA_DAILY_COST_CAP)
//  KK-kota-2  eşzamanlı akış sınırı (chat.userConcurrentStreams) ve bayat rezervasyon penceresi
//  KK-kota-3  iade (hata ile biten tur kotadan düşer), kapanış hatasında rezervasyon kalır
//  KK-kota-4  büro günlük tavanı paralel rezervasyonda kesin; gün sınırı İstanbul gece yarısı
//  KK-kota-5  başkasının rezervasyonu kapatılamaz; kapanış tekrar çalışmaz
import { randomUUID } from 'node:crypto';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { createTestingDb, type TestingDb } from '@eda/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { adminDbFromEnv, closeAdmin } from '../../src/admin/db.ts';
import * as repo from '../../src/repositories/ai-keys/platform-usage.ts';
import {
  createPlatformKeyGate,
  type PlatformKeyGate,
  reservedCostMicroUsd,
} from '../../src/services/ai-keys/platform-gate.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { host: string; port: number; database: string; secretsDir: string };
  }
}

const KEY = randomUUID().slice(0, 8);
const START = { modelAlias: 'edai-flash', conversationId: null, requestId: null } as const;
const NOW = () => new Date();

let db: TestingDb;
const gateOf = (extra: { onRecordFailed?: (e: unknown) => void } = {}): PlatformKeyGate =>
  createPlatformKeyGate({ db: db.runner('eda_app'), now: NOW, ...extra });

async function newOrg(tag: string, seats = 5) {
  const org = await db.auth.insertOrg(`Büro ${tag}`, 'firm');
  await db.auth.grantSeats(org, seats);
  return org;
}
async function newMember(org: string, tag: string) {
  const id = await db.auth.insertUser({
    name: `Üye ${tag}`,
    email: `${tag}.${KEY}@ornek.test`,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  await db.auth.addMember(org, id, 'lawyer');
  return id;
}
let adminId = '';
const adm = async <T>(fn: (q: (sql: string, p: unknown[]) => Promise<unknown>) => Promise<T>) =>
  adminDbFromEnv().withAdminWrite((tx) => fn((sql, p) => tx.query(sql, p)));
async function setUserLimits(
  userId: string,
  v: { turnsDay?: number | null; tokensDay?: number | null },
) {
  await adm((q) =>
    q('SELECT app.admin_set_user_limits($1, $2, $3, NULL, $4, NULL)', [
      adminId,
      userId,
      v.turnsDay ?? null,
      v.tokensDay ?? null,
    ]),
  );
}
const setUserTurns = (userId: string, perDay: number) =>
  setUserLimits(userId, { turnsDay: perDay });
/** Büro günlük tavanını `micro` yapar (koltuk başı değer 1: tavan = taban). */
async function setOrgCap(orgId: string, micro: number) {
  const vals: [string, number][] = [
    ['costGuard.orgDailyCapFloorMicroUsd', micro],
    ['costGuard.orgDailyCapPerSeatMicroUsd', 1],
  ];
  for (const [k, v] of vals) {
    await adm((q) => q('SELECT app.admin_org_limit_set($1, $2, $3, $4)', [adminId, orgId, k, v]));
  }
}
/** Sahip, tablodaki FORCE RLS'i yalnız bu çağrı için kapatır (test fixture'ı; dosyalar sırayla koşar). */
async function ownerRaw(sql: string, params: unknown[]) {
  await db.ownerQuery('ALTER TABLE app.platform_key_usage NO FORCE ROW LEVEL SECURITY', []);
  try {
    return await db.ownerQuery(sql, params);
  } finally {
    await db.ownerQuery('ALTER TABLE app.platform_key_usage FORCE ROW LEVEL SECURITY', []);
  }
}
const rowsOf = async (userId: string) =>
  (await ownerRaw(
    `SELECT (CASE reservation WHEN 'open' THEN 'reserved' ELSE coalesce(reservation, status) END) AS status, cost_micro_usd FROM app.platform_key_usage WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  )) as { status: string; cost_micro_usd: string }[];
const countStatus = async (userId: string, status: string) =>
  (await rowsOf(userId)).filter((r) => r.status === status).length;

type Outcome = 'ok' | 'quota' | 'concurrent' | 'other';
/** Bir tur dener: başarılıysa hemen başarıyla kapatır. */
async function attempt(
  g: PlatformKeyGate,
  actor: { orgId: string; userId: string },
  retryConcurrent: boolean,
): Promise<Outcome> {
  for (;;) {
    try {
      const h = await g.begin(actor, START);
      await h.finish({ inputTokens: 1, outputTokens: 1, status: 'success' });
      return 'ok';
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'RATE_LIMITED' && retryConcurrent) {
        await new Promise((r) => setTimeout(r, 5));
        continue;
      }
      if (code === 'QUOTA_DAILY_COST_CAP') return 'quota';
      if (code === 'RATE_LIMITED') return 'concurrent';
      return 'other';
    }
  }
}

beforeAll(async () => {
  db = createTestingDb(inject('pg'));
  adminId = await db.auth.insertUser({
    name: 'Yönetici',
    email: `kota-yonetici.${KEY}@ornek.test`,
    emailVerified: true,
    verificationStatus: 'verified',
  });
  await db.auth.setPlatformRole(adminId, 'super_admin');
});
afterAll(async () => {
  await closeAdmin().catch(() => undefined);
  await db?.close();
});

describe('KK-kota-1: eşzamanlı rezervasyon limiti kesin uygular', () => {
  it('aynı kullanıcıdan 10 paralel tur, günlük sınır 3: tam 3 başarılı, 7 reddedilir; tabloda 3 satır', async () => {
    const org = await newOrg('kota-1a');
    const u = await newMember(org, 'kota-1a');
    await setUserTurns(u, 3);
    const g = gateOf();
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => attempt(g, { orgId: org, userId: u }, true)),
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(3);
    expect(outcomes.filter((o) => o === 'quota')).toHaveLength(7);
    expect(await rowsOf(u)).toHaveLength(3);
  });

  it('iki ayrı gate örneği (iki süreç) aynı sınırı paylaşır: bellek değil veritabanı sayar', async () => {
    const org = await newOrg('kota-1b');
    const u = await newMember(org, 'kota-1b');
    await setUserTurns(u, 4);
    const gates = [gateOf(), gateOf(), gateOf()];
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        attempt(gates[i % 3] as PlatformKeyGate, { orgId: org, userId: u }, true),
      ),
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(4);
    expect(outcomes.filter((o) => o === 'quota')).toHaveLength(8);
  });

  it('reddedilen istek satır eklemez ve açık, düzeltici Türkçe hata verir (retryAfterSec dolu)', async () => {
    const org = await newOrg('kota-1c');
    const u = await newMember(org, 'kota-1c');
    await setUserTurns(u, 1);
    const g = gateOf();
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('ok');
    const err = await g.begin({ orgId: org, userId: u }, START).then(
      () => null,
      (e: unknown) => e as { code: string; reason?: string; meta?: { retryAfterSec?: number } },
    );
    expect(err).toMatchObject({ code: 'QUOTA_DAILY_COST_CAP', reason: 'platform_key_user_day' });
    expect(err?.meta?.retryAfterSec).toBeGreaterThanOrEqual(60);
    expect(await rowsOf(u)).toHaveLength(1);
  });
});

describe('KK-kota-2: eşzamanlı akış sınırı', () => {
  it('paralel 10 deneme (yeniden denemesiz): yalnız sınır kadar (1) tur başlar, kalanı RATE_LIMITED', async () => {
    expect(CONFIG_DEFAULTS['chat.userConcurrentStreams']).toBe(1);
    const org = await newOrg('kota-2a');
    const u = await newMember(org, 'kota-2a');
    const g = gateOf();
    const started: { finish: (u: never) => Promise<void> }[] = [];
    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        try {
          started.push((await g.begin({ orgId: org, userId: u }, START)) as never);
          return 'ok';
        } catch (e) {
          return (e as { code: string }).code;
        }
      }),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r === 'RATE_LIMITED')).toHaveLength(9);
    expect(await countStatus(u, 'reserved')).toBe(1);
    // Tur bitince yer açılır.
    await started[0]?.finish({ inputTokens: 1, outputTokens: 1, status: 'success' } as never);
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('ok');
  });

  it('süresi geçmiş (bayat) rezervasyon eşzamanlılığı kilitlemez ama tur olarak sayılmaya devam eder', async () => {
    const org = await newOrg('kota-2b');
    const u = await newMember(org, 'kota-2b');
    await setUserTurns(u, 2);
    const g = gateOf();
    await g.begin({ orgId: org, userId: u }, START); // hiç kapatılmaz (süreç çöktü)
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('concurrent');
    await ownerRaw(
      `UPDATE app.platform_key_usage SET created_at = now() - make_interval(secs => $2)
       WHERE user_id = $1 AND reservation = 'open'`,
      [u, CONFIG_DEFAULTS['llm.proxyTimeoutSec'] + 60],
    );
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('ok');
    // İki satır (bayat rezervasyon + yeni tur) günlük sınırı doldurdu.
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('quota');
  });
});

describe('KK-kota-3: iade ve kapanış hatası', () => {
  it('hiç kullanılmadan hata ile biten tur iade edilir: sayaca girmez, sınır yeniden açılır', async () => {
    const org = await newOrg('kota-3a');
    const u = await newMember(org, 'kota-3a');
    await setUserTurns(u, 1);
    const g = gateOf();
    const h = await g.begin({ orgId: org, userId: u }, START);
    await h.finish({ inputTokens: 0, outputTokens: 0, status: 'error' });
    expect(await countStatus(u, 'released')).toBe(1);
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('ok');
    // Gerçek bir tur sınırı yine doldurur.
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('quota');
  });

  it('kullanımı bilinmeyen başarılı tur iade edilmez ve rezerve maliyetle kapanır (kota korunur)', async () => {
    const org = await newOrg('kota-3b');
    const u = await newMember(org, 'kota-3b');
    const h = await gateOf().begin({ orgId: org, userId: u }, START);
    await h.finish({ inputTokens: 0, outputTokens: 0, status: 'success' });
    const rows = await rowsOf(u);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'success',
      cost_micro_usd: String(reservedCostMicroUsd()),
    });
  });

  it('gerçek kullanım yazılır: token ve tahmini maliyet', async () => {
    const org = await newOrg('kota-3c');
    const u = await newMember(org, 'kota-3c');
    const h = await gateOf().begin({ orgId: org, userId: u }, START);
    await h.finish({ inputTokens: 1000, outputTokens: 500, status: 'success' });
    const r = (await ownerRaw(
      'SELECT input_tokens, output_tokens, cost_micro_usd, status FROM app.platform_key_usage WHERE user_id = $1',
      [u],
    )) as Record<string, unknown>[];
    expect(r[0]).toMatchObject({ input_tokens: 1000, output_tokens: 500, status: 'success' });
    expect(Number(r[0]?.cost_micro_usd)).toBe(
      Math.ceil((1500 * CONFIG_DEFAULTS['platformKey.estimatedMicroUsdPerMtok']) / 1_000_000),
    );
  });

  it('günlük token sınırı gerçek kullanımla uygulanır: aşım bir sonraki turu reddeder', async () => {
    const org = await newOrg('kota-3d');
    const u = await newMember(org, 'kota-3d');
    await setUserLimits(u, { tokensDay: 100 });
    const g = gateOf();
    const h = await g.begin({ orgId: org, userId: u }, START);
    await h.finish({ inputTokens: 90, outputTokens: 60, status: 'success' });
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('quota');
  });

  it('kapanış yazılamazsa onRecordFailed çağrılır, rezervasyon açık kalır ve kota korunur', async () => {
    const org = await newOrg('kota-3e');
    const u = await newMember(org, 'kota-3e');
    await setUserTurns(u, 1);
    let failed = 0;
    const real = db.runner('eda_app');
    let breakSettle = false;
    const flaky = {
      withTenant: ((ctx: never, fn: (tx: never) => Promise<unknown>) =>
        real.withTenant(ctx, (tx) =>
          fn({
            query: async (sql: string, p?: unknown[]) => {
              if (breakSettle && sql.includes('platform_key_settle')) throw new Error('kesinti');
              return (tx as { query: (s: string, p?: unknown[]) => Promise<unknown> }).query(
                sql,
                p,
              );
            },
          } as never),
        )) as never,
    };
    const g = createPlatformKeyGate({
      db: flaky,
      now: NOW,
      onRecordFailed: () => {
        failed += 1;
      },
    });
    const h = await g.begin({ orgId: org, userId: u }, START);
    breakSettle = true;
    await h.finish({ inputTokens: 5, outputTokens: 5, status: 'success' });
    expect(failed).toBe(1);
    expect(await countStatus(u, 'reserved')).toBe(1);
    breakSettle = false;
    expect(await attempt(gateOf(), { orgId: org, userId: u }, false)).toBe('quota');
  });
});

describe('KK-kota-4: büro tavanı ve gün sınırı', () => {
  it('büro tavanı paralel rezervasyonda kesindir: tavan bir tur maliyetine eşitken yalnız biri geçer', async () => {
    const org = await newOrg('kota-4a');
    const users = await Promise.all(
      Array.from({ length: 5 }, (_, i) => newMember(org, `kota-4a-${i}`)),
    );
    await setOrgCap(org, reservedCostMicroUsd());
    const g = gateOf();
    // Turlar sürerken (rezervasyonlar açık) paralel başlar: yalnız ilk rezervasyon tavan altında kalır.
    const outcomes = await Promise.all(
      users.map((userId) =>
        g.begin({ orgId: org, userId }, START).then(
          () => 'ok',
          (e: { code?: string }) => e.code ?? 'other',
        ),
      ),
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'QUOTA_DAILY_COST_CAP')).toHaveLength(4);
    const err = await g.begin({ orgId: org, userId: users[0] as string }, START).then(
      () => null,
      (e: unknown) => e as { reason?: string },
    );
    expect(err?.reason).toBe('platform_key_org_day');
  });

  it('platform geneli günlük tavan: farklı bürolar toplamda tavanı aşamaz (kesin)', async () => {
    const orgs = await Promise.all(['kota-4p1', 'kota-4p2', 'kota-4p3'].map((t) => newOrg(t)));
    const users = await Promise.all(orgs.map((o, i) => newMember(o, `kota-4p-${i}`)));
    const sum = Number(
      (
        (await ownerRaw(
          `SELECT coalesce(sum(cost_micro_usd), 0) AS s FROM app.platform_key_usage
          WHERE reservation IS DISTINCT FROM 'released' AND created_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul')`,
          [],
        )) as { s: string }[]
      )[0]?.s ?? 0,
    );
    const r = db.runner('eda_app');
    const outcomes = await Promise.all(
      orgs.map((orgId, i) =>
        r
          .withTenant({ orgId, userId: users[i] as string }, (tx) =>
            repo.reserveTurn(tx, {
              turnsDay: null,
              tokensDay: null,
              turnsMonth: null,
              tokensMonth: null,
              orgCap: null,
              platformCap: sum + 1,
              reserveCostMicroUsd: 10,
              maxConcurrent: null,
              activeWindowSec: 600,
              modelAlias: 'edai-flash',
              conversationId: null,
              requestId: null,
            }),
          )
          .then((x) => ('reservationId' in x ? 'ok' : x.denied)),
      ),
    );
    expect(outcomes.filter((o) => o === 'ok')).toHaveLength(1);
    expect(outcomes.filter((o) => o === 'platform_day')).toHaveLength(2);
  });

  it('başka büro etkilenmez', async () => {
    const a = await newOrg('kota-4b');
    const b = await newOrg('kota-4c');
    const ua = await newMember(a, 'kota-4b');
    const ub = await newMember(b, 'kota-4c');
    await setOrgCap(a, 1);
    const g = gateOf();
    expect(await attempt(g, { orgId: a, userId: ua }, false)).toBe('ok');
    expect(await attempt(g, { orgId: a, userId: ua }, false)).toBe('quota');
    expect(await attempt(g, { orgId: b, userId: ub }, false)).toBe('ok');
  });

  it('gün sınırı Europe/Istanbul: gece yarısından önceki kayıtlar bugünü doldurmaz, sonrakiler doldurur', async () => {
    const org = await newOrg('kota-4d');
    const u = await newMember(org, 'kota-4d');
    await setUserTurns(u, 2);
    const g = gateOf();
    await attempt(g, { orgId: org, userId: u }, false);
    await attempt(g, { orgId: org, userId: u }, false);
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('quota');
    // İstanbul gününün başlangıcından 1 dakika ÖNCEYE taşınan iki kayıt dünü sayılır.
    await ownerRaw(
      `UPDATE app.platform_key_usage
          SET created_at = (pg_catalog.date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul')
                            AT TIME ZONE 'Europe/Istanbul') - interval '1 minute'
        WHERE user_id = $1`,
      [u],
    );
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('ok');
    // Gece yarısından 1 dakika SONRAya taşınan kayıt bugünü sayar.
    await ownerRaw(
      `UPDATE app.platform_key_usage
          SET created_at = (pg_catalog.date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul')
                            AT TIME ZONE 'Europe/Istanbul') + interval '1 minute'
        WHERE user_id = $1`,
      [u],
    );
    expect(await attempt(g, { orgId: org, userId: u }, false)).toBe('quota');
  });
});

describe('KK-kota-5: rezervasyon kapanışının sınırları', () => {
  it('başka kullanıcının rezervasyonu kapatılamaz; kapanış iki kez çalışmaz', async () => {
    const org = await newOrg('kota-5a');
    const u1 = await newMember(org, 'kota-5a1');
    const u2 = await newMember(org, 'kota-5a2');
    const r = db.runner('eda_app');
    const res = await r.withTenant({ orgId: org, userId: u1 }, (tx) =>
      repo.reserveTurn(tx, {
        turnsDay: 5,
        tokensDay: null,
        turnsMonth: null,
        tokensMonth: null,
        orgCap: null,
        platformCap: null,
        reserveCostMicroUsd: 10,
        maxConcurrent: 1,
        activeWindowSec: 600,
        modelAlias: 'edai-pro',
        conversationId: null,
        requestId: null,
      }),
    );
    if (!('reservationId' in res)) throw new Error('rezervasyon beklenirdi');
    const close = (userId: string, status: 'success' | 'released' = 'success') =>
      r.withTenant({ orgId: org, userId }, (tx) =>
        repo.settleTurn(tx, {
          reservationId: res.reservationId,
          status,
          inputTokens: 1,
          outputTokens: 1,
          costMicroUsd: 1,
        }),
      );
    expect(await close(u2)).toBe(false);
    expect(await countStatus(u1, 'reserved')).toBe(1);
    expect(await close(u1)).toBe(true);
    expect(await close(u1, 'released')).toBe(false);
    expect((await rowsOf(u1))[0]).toMatchObject({ status: 'success' });
  });

  it('doğrulanmamış üye rezervasyon yapamaz (42501)', async () => {
    const org = await newOrg('kota-5b');
    const id = await db.auth.insertUser({
      name: 'Bekleyen',
      email: `kota-5b.${KEY}@ornek.test`,
      emailVerified: true,
      verificationStatus: 'pending_verification',
    });
    await db.auth.addMember(org, id, 'lawyer');
    await expect(gateOf().begin({ orgId: org, userId: id }, START)).rejects.toMatchObject({
      code: 'AUTH_PENDING_VERIFICATION',
    });
  });

  it('uygulama rolü rezervasyon satırını doğrudan güncelleyemez (yalnız fonksiyonlarla)', async () => {
    const org = await newOrg('kota-5c');
    const u = await newMember(org, 'kota-5c');
    await gateOf().begin({ orgId: org, userId: u }, START);
    await expect(
      db
        .runner('eda_app')
        .withTenant({ orgId: org, userId: u }, (tx) =>
          tx.query(
            "UPDATE app.platform_key_usage SET reservation = 'released' WHERE user_id = $1",
            [u],
          ),
        ),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
