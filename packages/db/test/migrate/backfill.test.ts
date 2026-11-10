// @tk TK-29
// FORCE RLS tuzağı ve `-- eda:backfill` sarmalayıcısı (032 §9; KK-032-8). Geçici kiracılı test tablosu
// app şemasında kurulur (E5 yalnız auth/app/corpus'a bakar) ve test sonunda düşürülür.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAuditQueries, runAudit } from '../../src/migrate/audit.ts';
import { AUDIT_FILES, defaultAuditParams, EXIT } from '../../src/migrate/index.ts';
import { ownerDb } from '../fixtures/db.ts';
import { newWorldKey, shortKey } from '../fixtures/ids.ts';
import { createScratch, memoryLogger, type Scratch } from '../fixtures/scratch.ts';

const ROWS = 20_000;
let owner: pg.Client;
let scratch: Scratch;
let table: string;

beforeAll(async () => {
  owner = await ownerDb();
  table = `app.t_bf_${shortKey(newWorldKey())}`;
  await owner.query(
    `CREATE TABLE ${table} (id uuid PRIMARY KEY DEFAULT uuidv7(), org_id uuid NOT NULL, visibility text)`,
  );
  await owner.query(
    `INSERT INTO ${table} (org_id) SELECT uuidv7() FROM generate_series(1, ${ROWS})`,
  );
  // Kiracılı tablo kalıbı: ENABLE + FORCE; bağlamsız erişim hiçbir satır görmez.
  await owner.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await owner.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  await owner.query(`CREATE POLICY t_bf_none ON ${table} USING (false) WITH CHECK (false)`);
  scratch = await createScratch(owner);
});

afterAll(async () => {
  await owner.query(`DROP TABLE IF EXISTS ${table}`);
  await scratch.drop(owner);
  await owner.end();
});

async function counts(): Promise<{ total: number; done: number }> {
  // Sayım RLS'siz görünüm için eda_sec_definer'a geçici okuma yetkisiyle yapılır (işlem içinde).
  await owner.query('BEGIN');
  try {
    await owner.query(`GRANT SELECT (visibility) ON ${table} TO eda_sec_definer`);
    await owner.query('SET LOCAL ROLE eda_sec_definer');
    const res = await owner.query<{ total: string; done: string }>(
      `SELECT count(*) AS total, count(*) FILTER (WHERE visibility = 'org') AS done FROM ${table}`,
    );
    return { total: Number(res.rows[0]?.total), done: Number(res.rows[0]?.done) };
  } finally {
    await owner.query('ROLLBACK');
  }
}

describe('KK-P03a-10 (KK-032-8): FORCE tuzağı ve eda:backfill-batched', () => {
  it('çıplak UPDATE (eda_owner, FORCE) hata vermeden 0 satır etkiler', async () => {
    const res = await owner.query(`UPDATE ${table} SET visibility = 'org'`);
    expect(res.rowCount).toBe(0);
    expect(await counts()).toEqual({ total: ROWS, done: 0 });
  });

  it('çalıştırıcı backfill-batched ile tüm satırları yığınlar hâlinde günceller; yetki kalıntısı yok (E5 = 0)', async () => {
    const name = table.split('.')[1] ?? '';
    scratch.write([
      {
        name: 'backfill_visibility',
        sql: [
          '-- eda:kind backfill',
          `-- eda:backfill-batched app.${name}(visibility) batch=5000 sleep=0ms`,
          `UPDATE ${table} SET visibility = 'org'`,
          `WHERE id IN (SELECT id FROM ${table} WHERE visibility IS NULL ORDER BY id LIMIT $batch)`,
          '',
        ].join('\n'),
      },
    ]);
    const log = memoryLogger();
    expect(await scratch.run(owner, log)).toBe(EXIT.ok);
    const batches = log.events('backfill.batch');
    expect(batches.map((b) => b.rows)).toEqual([5000, 5000, 5000, 5000, 0]);
    expect(await counts()).toEqual({ total: ROWS, done: ROWS });

    const priv = await owner.query<{ upd: boolean; sel: boolean }>(
      `SELECT has_column_privilege('eda_sec_definer', $1::regclass, 'visibility', 'UPDATE') AS upd,
              has_column_privilege('eda_sec_definer', $1::regclass, 'visibility', 'SELECT') AS sel`,
      [table],
    );
    expect(priv.rows[0]).toEqual({ upd: false, sel: false });
    const queries = (await loadAuditQueries(AUDIT_FILES)).filter((q) => q.id === 'E5');
    expect(queries).toHaveLength(1);
    expect(await runAudit(owner, queries, defaultAuditParams('test'))).toEqual([]);
  });

  it('tek seferlik eda:backfill aynı işlemde yetki verip geri alır; işlem geri alınırsa yetki kalmaz', async () => {
    const name = table.split('.')[1] ?? '';
    const s2 = await createScratch(owner);
    try {
      s2.write([
        {
          name: 'backfill_reset',
          sql: [
            '-- eda:kind backfill',
            `-- eda:backfill app.${name}(visibility)`,
            `UPDATE ${table} SET visibility = NULL WHERE visibility = 'org';`,
            'SELECT 1 / 0;',
            '',
          ].join('\n'),
        },
      ]);
      expect(await s2.run(owner, memoryLogger())).toBe(EXIT.sqlError);
      expect(await counts()).toEqual({ total: ROWS, done: ROWS });
      const e5 = (await loadAuditQueries(AUDIT_FILES)).filter((q) => q.id === 'E5');
      expect(await runAudit(owner, e5, defaultAuditParams('test'))).toEqual([]);
    } finally {
      await s2.drop(owner);
    }
  });
});
