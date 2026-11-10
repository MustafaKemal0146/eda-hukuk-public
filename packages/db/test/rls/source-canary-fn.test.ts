// @tk TK-26
// Kaynak kanaryası (0052; 021 §7.3): `corpus.source_canary_runs` yetkileri (eda_worker yazar, eda_app
// okur, eda_jobs ve ham yönetim rolü tabloya dokunamaz), `@eda/db/canary` depo fonksiyonları (yoklama
// başına son N sonuç, pencere silme, `source_status.last_canary_*`) ve `app.admin_system_source_canary`
// (yalnız super_admin; son sonuç, pencere içi oran, art arda başarısızlık). Tablo kiracısızdır; test
// başında ve sonunda boşaltılır (başka test kullanmaz).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminDb, createAdminDb } from '../../src/admin.ts';
import {
  insertCanaryRuns,
  markSourceCanary,
  purgeCanaryRuns,
  recentCanaryOutcomes,
} from '../../src/canary.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { adminDb, appDb, jobsDb, makePool, ownerDb, pgCode } from '../fixtures/db.ts';
import { newWorldKey } from '../fixtures/ids.ts';
import { insertUser } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let jobs: pg.Client;
let rawAdmin: pg.Client;
let rawApp: pg.Client;
let workerPool: pg.Pool;
let worker: TenantRunner;
let admin: AdminDb;
let superId: string;
let supportId: string;
let memberId: string;

const codeOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => pgCode(e).code,
  );
const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000);

async function staff(tag: string, key: string, role: 'support' | 'super_admin'): Promise<string> {
  const r = await owner.query<{ id: string }>(
    `INSERT INTO auth.users (name, email, email_verified, platform_role, verification_status)
     VALUES ($1, $2, true, $3, 'verified') RETURNING id`,
    [`Örnek ${tag}`, `${tag}.${key}@ornek.test`, role],
  );
  return r.rows[0]?.id ?? '';
}

beforeAll(async () => {
  owner = await ownerDb();
  jobs = await jobsDb();
  rawAdmin = await adminDb();
  rawApp = await appDb();
  workerPool = makePool('eda_worker');
  worker = createTenantRunner(workerPool);
  admin = createAdminDb(makePool('eda_readonly_admin'));
  const key = newWorldKey();
  superId = await staff('kanarya-super', key, 'super_admin');
  supportId = await staff('kanarya-destek', key, 'support');
  memberId = await insertUser(owner, key, 'kanarya-uye');
  await owner.query('DELETE FROM corpus.source_canary_runs');
});
afterAll(async () => {
  await owner.query('DELETE FROM corpus.source_canary_runs');
  await owner.end();
  await jobs.end();
  await rawAdmin.end();
  await rawApp.end();
  await workerPool.end();
  await admin.end();
});

describe('KK-021-7.3 source_canary_runs yetkileri', () => {
  it('eda_worker yazar; eda_app okur ama yazamaz; eda_jobs ve ham yönetim rolü erişemez', async () => {
    await worker.withNoTenant('corpus', (tx) =>
      insertCanaryRuns(tx, [
        { probe: 'anayasa_search', outcome: 'ok', durationMs: 12.4, checkedAt: daysAgo(1) },
      ]),
    );
    expect(
      (await rawApp.query('SELECT probe, duration_ms FROM corpus.source_canary_runs')).rows,
    ).toEqual([{ probe: 'anayasa_search', duration_ms: 12 }]);
    expect(
      await codeOf(
        rawApp.query(
          "INSERT INTO corpus.source_canary_runs (probe, outcome, duration_ms) VALUES ('anayasa_search', 'ok', 1)",
        ),
      ),
    ).toBe('42501');
    for (const c of [jobs, rawAdmin]) {
      expect(await codeOf(c.query('SELECT probe FROM corpus.source_canary_runs'))).toBe('42501');
    }
  });

  it('CHECK: bilinmeyen yoklama/sonuç ve negatif süre reddedilir', async () => {
    for (const [p, o, d] of [
      ['yargitay_search', 'ok', 1],
      ['anayasa_search', 'down', 1],
      ['anayasa_search', 'ok', -1],
    ] as const) {
      expect(
        await codeOf(
          owner.query(
            'INSERT INTO corpus.source_canary_runs (probe, outcome, duration_ms) VALUES ($1, $2, $3)',
            [p, o, d],
          ),
        ),
      ).toBe('23514');
    }
  });
});

describe('KK-021-7.3 @eda/db/canary depo fonksiyonları', () => {
  it('yoklama başına en yeni N sonuç; pencere dışı silinir; source_status satırı varsa güncellenir', async () => {
    await owner.query('DELETE FROM corpus.source_canary_runs');
    await worker.withNoTenant('corpus', (tx) =>
      insertCanaryRuns(tx, [
        { probe: 'uyap_search', outcome: 'ok', durationMs: 5, checkedAt: daysAgo(9) },
        { probe: 'uyap_search', outcome: 'ok', durationMs: 5, checkedAt: daysAgo(3) },
        { probe: 'uyap_search', outcome: 'error', durationMs: 5, checkedAt: daysAgo(2) },
        { probe: 'uyap_search', outcome: 'timeout', durationMs: 5, checkedAt: daysAgo(1) },
        { probe: 'mevzuat_article', outcome: 'empty', durationMs: 5, checkedAt: daysAgo(1) },
      ]),
    );
    const recent = await worker.withNoTenant('corpus', (tx) => recentCanaryOutcomes(tx, 2));
    expect(Object.fromEntries(recent)).toEqual({
      uyap_search: ['timeout', 'error'],
      mevzuat_article: ['empty'],
    });
    const purged = await worker.withNoTenant('corpus', (tx) => purgeCanaryRuns(tx, daysAgo(7)));
    expect(purged).toBe(1);

    await owner.query(
      `INSERT INTO corpus.source_status (source) VALUES ('uyusmazlik') ON CONFLICT (source) DO NOTHING`,
    );
    const at = daysAgo(0);
    const n = await worker.withNoTenant('corpus', (tx) =>
      markSourceCanary(tx, 'uyusmazlik', at, false),
    );
    expect(n).toBe(1);
    const row = (
      await owner.query<{ ok: boolean }>(
        "SELECT last_canary_ok AS ok FROM corpus.source_status WHERE source = 'uyusmazlik'",
      )
    ).rows[0];
    expect(row?.ok).toBe(false);
  });
});

describe('KK-021-7.3 app.admin_system_source_canary', () => {
  it('yalnız super_admin; support ve sıradan kullanıcı 42501; eda_app çağıramaz; geçersiz pencere 22023', async () => {
    for (const actor of [supportId, memberId]) {
      expect(
        await codeOf(
          admin.withAdmin((tx) =>
            tx.query('SELECT * FROM app.admin_system_source_canary($1, 7)', [actor]),
          ),
        ),
      ).toBe('42501');
    }
    expect(
      await codeOf(rawApp.query('SELECT * FROM app.admin_system_source_canary($1, 7)', [superId])),
    ).toBe('42501');
    expect(
      await codeOf(
        admin.withAdmin((tx) =>
          tx.query('SELECT * FROM app.admin_system_source_canary($1, 0)', [superId]),
        ),
      ),
    ).toBe('22023');
  });

  it('son sonuç, pencere içi çalıştırma/başarı ve son başarıdan sonraki art arda başarısızlık', async () => {
    await owner.query('DELETE FROM corpus.source_canary_runs');
    await worker.withNoTenant('corpus', (tx) =>
      insertCanaryRuns(tx, [
        { probe: 'uyap_search', outcome: 'ok', durationMs: 900, checkedAt: daysAgo(10) },
        { probe: 'uyap_search', outcome: 'ok', durationMs: 800, checkedAt: daysAgo(4) },
        { probe: 'uyap_search', outcome: 'error', durationMs: 50, checkedAt: daysAgo(2) },
        { probe: 'uyap_search', outcome: 'timeout', durationMs: 40000, checkedAt: daysAgo(1) },
        { probe: 'mevzuat_search', outcome: 'ok', durationMs: 300, checkedAt: daysAgo(1) },
        { probe: 'anayasa_search', outcome: 'empty', durationMs: 70, checkedAt: daysAgo(1) },
      ]),
    );
    const rows = (
      await admin.withAdmin((tx) =>
        tx.query('SELECT * FROM app.admin_system_source_canary($1, 7)', [superId]),
      )
    ).rows as Record<string, unknown>[];
    const by = Object.fromEntries(rows.map((r) => [String(r.probe), r]));
    expect(Object.keys(by).sort()).toEqual(['anayasa_search', 'mevzuat_search', 'uyap_search']);
    expect(by.uyap_search).toMatchObject({
      last_outcome: 'timeout',
      last_duration_ms: 40000,
      window_runs: 3,
      window_ok: 1,
      consecutive_failures: 2,
    });
    expect(by.mevzuat_search).toMatchObject({
      last_outcome: 'ok',
      window_runs: 1,
      window_ok: 1,
      consecutive_failures: 0,
    });
    expect(by.anayasa_search).toMatchObject({ window_ok: 0, consecutive_failures: 1 });
    // İçerik yok: yalnız kod, sonuç, süre ve sayılar.
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      'consecutive_failures',
      'last_checked_at',
      'last_duration_ms',
      'last_outcome',
      'probe',
      'window_ok',
      'window_runs',
    ]);
  });
});
