// @tk TK-26
// KK-P03c-16 (KK-043-12 DB kısmı): audit.seal dakika penceresinde mühürler; satırı elle değiştirilen
// pencere doğrulamada uyuşmazlık verir; iki eşzamanlı koşu tek mühür üretir; mühürler prev_seal_hash
// ile zincirlidir. audit_log satırları yalnız app.audit_append ile yazılır (created_at = now()); pencere
// testleri için satırlar eda_owner DDL yetkisiyle (NO FORCE RLS + kullanıcı tetikleyicileri kapalı,
// tek işlemde) geriye alınır. Aynı yol "elle bozma" senaryosudur: veritabanı sahibi düzeyinde değişiklik
// mühür doğrulamasıyla yakalanır (süper kullanıcı TEST yığınında ağdan bağlanamaz).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAuditSeal, verifyAuditSeals } from '../../src/jobs/audit-seal.ts';
import { type JobsDb, wrapJobsPool } from '../../src/jobs/db.ts';
import { createTenantRunner, type TenantRunner } from '../../src/tenant.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { createTenantWorld, type TenantWorld } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
let ownerPool: pg.Pool;
let appPool: pg.Pool;
let asApp: TenantRunner;
let jobsA: JobsDb;
let jobsB: JobsDb;
let w: TenantWorld;

beforeAll(async () => {
  owner = await ownerDb();
  ownerPool = makePool('eda_owner');
  appPool = makePool('eda_app');
  asApp = createTenantRunner(appPool);
  jobsA = wrapJobsPool(makePool('eda_jobs', 2));
  jobsB = wrapJobsPool(makePool('eda_jobs', 2));
  w = await createTenantWorld(owner, createTenantRunner(ownerPool));
  // Önceki test dosyalarının bekleyen zincirleri bu dosyanın sayımlarını etkilemesin.
  await runAuditSeal(jobsA);
});
afterAll(async () => {
  await owner.end();
  await ownerPool.end();
  await appPool.end();
  await jobsA.end();
  await jobsB.end();
});

async function appendRows(orgId: string, userId: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const id = await asApp.withTenant({ orgId, userId }, async (tx) => {
      const r = await tx.query<{ id: string }>(
        `SELECT app.audit_append('org.settings.changed', 'org', 'org_settings', $1, '{"step":1}'::jsonb, NULL) AS id`,
        [orgId],
      );
      return r.rows[0]?.id ?? '';
    });
    ids.push(id);
  }
  return ids;
}

/** Sahip düzeyi DDL ile ekli tablo korumasını tek işlemde aşar (test kurgusu / bozma senaryosu). */
async function asOwnerUnguarded(sql: string, params: unknown[]): Promise<number> {
  await owner.query('BEGIN');
  try {
    await owner.query('ALTER TABLE app.audit_log DISABLE TRIGGER USER');
    await owner.query('ALTER TABLE app.audit_log NO FORCE ROW LEVEL SECURITY');
    const r = await owner.query(sql, params);
    await owner.query('ALTER TABLE app.audit_log FORCE ROW LEVEL SECURITY');
    await owner.query('ALTER TABLE app.audit_log ENABLE TRIGGER USER');
    await owner.query('COMMIT');
    return r.rowCount ?? 0;
  } catch (err) {
    await owner.query('ROLLBACK');
    throw err;
  }
}

const backdate = (ids: string[], at: Date) =>
  asOwnerUnguarded('UPDATE app.audit_log SET created_at = $2 WHERE id = ANY ($1::uuid[])', [
    ids,
    at,
  ]);

interface SealRow {
  id: string;
  period_start: Date;
  period_end: Date;
  row_count: number;
  prev_seal_hash: Buffer | null;
  seal_hash: Buffer;
}
const sealsOf = async (orgId: string): Promise<SealRow[]> =>
  (
    await jobsA.query<SealRow>(
      `SELECT id::text AS id, period_start, period_end, row_count, prev_seal_hash, seal_hash
       FROM app.audit_seals WHERE chain_key = $1 ORDER BY period_start`,
      [orgId],
    )
  ).rows;

const MINUTE = 60_000;
const floorMinute = (ms: number) => Math.floor(ms / MINUTE) * MINUTE;

describe('KK-P03c-16: audit.seal mühürleme ve doğrulama', () => {
  it('pencere ve gecikme: kesimden (now − sealLagMin) yeni satır mühürlenmez; eskisi dakika sınırında mühürlenir', async () => {
    const ids = await appendRows(w.orgA, w.aOwner, 3);
    // Gecikme içindeki satırlar (created_at ≈ now) bu koşuda mühürlenmez.
    await runAuditSeal(jobsA);
    expect(await sealsOf(w.orgA)).toEqual([]);
    // Satırlar 10 dk geriye alınınca kesim penceresine girer.
    const t0 = new Date(Date.now() - 10 * MINUTE);
    await backdate(ids, t0);
    const now = new Date();
    const res = await runAuditSeal(jobsA, { now: () => now });
    expect(res.sealed).toBeGreaterThanOrEqual(1);
    const seals = await sealsOf(w.orgA);
    expect(seals).toHaveLength(1);
    expect(seals[0]?.row_count).toBe(3);
    expect(seals[0]?.prev_seal_hash).toBeNull();
    expect(seals[0]?.period_start.getTime()).toBe(floorMinute(t0.getTime()));
    expect(seals[0]?.period_end.getTime()).toBe(floorMinute(now.getTime() - 5 * MINUTE));
  });

  it('zincir: sonraki pencere önceki mührün bitişinden başlar ve prev_seal_hash ile bağlıdır', async () => {
    const [first] = await sealsOf(w.orgA);
    const ids = await appendRows(w.orgA, w.aOwner, 2);
    await backdate(ids, new Date((first?.period_end.getTime() ?? 0) + 10_000));
    await runAuditSeal(jobsA, { now: () => new Date(Date.now() + 2 * MINUTE) });
    const seals = await sealsOf(w.orgA);
    expect(seals).toHaveLength(2);
    expect(seals[1]?.period_start.getTime()).toBe(first?.period_end.getTime());
    expect(seals[1]?.row_count).toBe(2);
    expect(seals[1]?.prev_seal_hash?.equals(seals[0]?.seal_hash ?? Buffer.alloc(0))).toBe(true);
    const v = await verifyAuditSeals(jobsA);
    expect(v.checked).toBeGreaterThanOrEqual(2);
    expect(v.mismatches.filter((m) => m.chainKey === w.orgA)).toEqual([]);
  });

  it('iki eşzamanlı koşu aynı pencerede tek mühür üretir; ikinci çağrı no-op', async () => {
    const ids = await appendRows(w.orgB, w.bOwner, 2);
    await backdate(ids, new Date(Date.now() - 10 * MINUTE));
    const now = new Date();
    const [r1, r2] = await Promise.all([
      runAuditSeal(jobsA, { now: () => now }),
      runAuditSeal(jobsB, { now: () => now }),
    ]);
    expect(await sealsOf(w.orgB)).toHaveLength(1);
    expect(r1.sealed + r2.sealed).toBeGreaterThanOrEqual(1);
    const again = await runAuditSeal(jobsA, { now: () => now });
    expect(again.sealed).toBe(0);
    expect(await sealsOf(w.orgB)).toHaveLength(1);
  });

  it('audit_log satırı elle değiştirilince doğrulama uyuşmazlığı yakalar', async () => {
    const [seal] = await sealsOf(w.orgB);
    const row = await jobsA.query<{ id: string }>(
      'SELECT id::text AS id FROM app.audit_log WHERE org_id = $1 ORDER BY created_at LIMIT 1',
      [w.orgB],
    );
    expect(
      await asOwnerUnguarded("UPDATE app.audit_log SET target_id = 'kurcalandi' WHERE id = $1", [
        row.rows[0]?.id,
      ]),
    ).toBe(1);
    const v = await verifyAuditSeals(jobsA);
    expect(v.mismatches).toContainEqual({
      chainKey: w.orgB,
      sealId: seal?.id,
      reason: 'merkle_root',
    });
    // Satır silinmesi (sayım) da yakalanır.
    await asOwnerUnguarded('DELETE FROM app.audit_log WHERE id = $1', [row.rows[0]?.id]);
    const v2 = await verifyAuditSeals(jobsA);
    expect(v2.mismatches).toContainEqual({
      chainKey: w.orgB,
      sealId: seal?.id,
      reason: 'row_count',
    });
    expect(v2.mismatches.filter((m) => m.chainKey === w.orgA)).toEqual([]);
  });
});
