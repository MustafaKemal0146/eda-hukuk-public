// @tk TK-02
// KK-P03c-6 (KK-031-15): `has_case_access` içeren dava listesi sorgusu, 10.000 dava + 50 kısıtlı dava
// içeren sentetik büroda `EXPLAIN (ANALYZE, BUFFERS)` ile ölçülür. Ölçüm JSON satırı olarak standart
// çıktıya yazılır (`perf.case_list`); sonuç docs/perf/p03-rls-case-list.md'ye işlenir. Eşik: api p95
// < 300 ms bütçesinin (002 §7) DB payı; sorgu bu bütçeyi tek başına aşamaz.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { createTenantWorld, type TenantWorld } from '../fixtures/tenant-world.ts';

const ORG_CASES = 10_000;
const RESTRICTED = 50;
const RUNS = 20;
const BUDGET_MS = 300;

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let w: TenantWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app', 1);
  asApp = createTenantRunner(appPool);
  const asOwner = createTenantRunner(ownerPool);
  w = await createTenantWorld(owner, asOwner);
  // 10.000 büro görünürlüklü dava (a_lawyer1) + 50 kısıtlı dava (a_lawyer2; a_lawyer1 ekipte değil).
  await asOwner.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, (tx) =>
    tx.query(
      `INSERT INTO app.cases (org_id, owner_id, title, title_fold, visibility, created_by, created_at)
       SELECT $1, $2, 'Örnek veri dava ' || g, 'ornek veri dava ' || g, 'org', $2,
              now() - g * interval '1 minute'
       FROM generate_series(1, $3::int) g`,
      [w.orgA, w.aLawyer1, ORG_CASES],
    ),
  );
  await asOwner.withTenant({ orgId: w.orgA, userId: w.aLawyer2 }, (tx) =>
    tx.query(
      `INSERT INTO app.cases (org_id, owner_id, title, title_fold, visibility, created_by, created_at)
       SELECT $1, $2, 'Örnek veri kısıtlı ' || g, 'ornek veri kisitli ' || g, 'restricted', $2,
              now() - g * interval '30 seconds'
       FROM generate_series(1, $3::int) g`,
      [w.orgA, w.aLawyer2, RESTRICTED],
    ),
  );
  await owner.query('ANALYZE app.cases');
  await owner.query('ANALYZE app.case_members');
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
});

interface Plan {
  'Execution Time': number;
  'Planning Time': number;
  Plan: { 'Shared Hit Blocks'?: number; 'Shared Read Blocks'?: number };
}

async function explain(sql: string): Promise<Plan> {
  return asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
    const r = await tx.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    );
    // `json` (OID 114) uygulama havuzunda ham dizedir (src/pool.ts poolTypes).
    const plan = (JSON.parse(r.rows[0]?.['QUERY PLAN'] ?? '[]') as Plan[])[0];
    if (plan === undefined) throw new Error('EXPLAIN çıktısı boş');
    return plan;
  });
}

const p95 = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)] ?? 0;
};

describe('KK-P03c-6 (KK-031-15): dava listesi sorgusu EXPLAIN (ANALYZE) ölçümü', () => {
  it(`10.000 dava + 50 kısıtlı dava: liste ve sayım sorgusu p95 < ${BUDGET_MS} ms; kısıtlılar görünmez`, async () => {
    const LIST = `SELECT id, title, status, created_at FROM app.cases
                  WHERE status = 'active' ORDER BY created_at DESC LIMIT 50`;
    const COUNT = `SELECT count(*) FROM app.cases WHERE status = 'active'`;
    const visible = await asApp.withTenant({ orgId: w.orgA, userId: w.aLawyer1 }, async (tx) => {
      const r = await tx.query<{ n: string; restricted: string }>(
        `SELECT count(*) AS n, count(*) FILTER (WHERE visibility = 'restricted') AS restricted
         FROM app.cases`,
      );
      return r.rows[0];
    });
    // createTenantWorld A'da 1 dava açar (a_lawyer1, org) + 10.000; kısıtlı 50 görünmez.
    expect(Number(visible?.n)).toBe(ORG_CASES + 1);
    expect(Number(visible?.restricted)).toBe(0);

    const list: number[] = [];
    const count: number[] = [];
    let lastList: Plan | undefined;
    let lastCount: Plan | undefined;
    for (let i = 0; i < RUNS; i++) {
      lastList = await explain(LIST);
      list.push(lastList['Execution Time']);
      lastCount = await explain(COUNT);
      count.push(lastCount['Execution Time']);
    }
    const result = {
      event: 'perf.case_list',
      cases: ORG_CASES + 1 + RESTRICTED,
      restricted: RESTRICTED,
      runs: RUNS,
      list_p50_ms: [...list].sort((a, b) => a - b)[Math.floor(RUNS / 2)],
      list_p95_ms: p95(list),
      count_p50_ms: [...count].sort((a, b) => a - b)[Math.floor(RUNS / 2)],
      count_p95_ms: p95(count),
      list_planning_ms: lastList?.['Planning Time'],
      list_shared_hit_blocks: lastList?.Plan['Shared Hit Blocks'],
      count_shared_hit_blocks: lastCount?.Plan['Shared Hit Blocks'],
    };
    process.stdout.write(`${JSON.stringify(result)}\n`);
    expect(result.list_p95_ms).toBeLessThan(BUDGET_MS);
    expect(result.count_p95_ms).toBeLessThan(BUDGET_MS);
  });
});
