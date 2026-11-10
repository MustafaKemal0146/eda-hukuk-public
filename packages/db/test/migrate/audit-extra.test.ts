// @tk TK-02
// Denetim sorguları (031 §13 Q1–Q12, 032 §6.5 E3–E6): migrate sonrası her biri 0 satır; kasıtlı
// ihlalde ilgili sorgu satır döndürür ve migrate çıkış 50 verir. İhlaller işlem içinde kurulup geri
// alınır (CONCURRENTLY ve migrate senaryosu hariç; onlar finally'de temizlenir).
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AuditQuery, loadAuditQueries, runAudit } from '../../src/migrate/audit.ts';
import { AUDIT_FILES, defaultAuditParams, EXIT } from '../../src/migrate/index.ts';
import { ownerDb } from '../fixtures/db.ts';
import { newWorldKey, shortKey } from '../fixtures/ids.ts';
import { createScratch, memoryLogger } from '../fixtures/scratch.ts';

let owner: pg.Client;
let queries: AuditQuery[];
const params = defaultAuditParams('test');

beforeAll(async () => {
  owner = await ownerDb();
  queries = await loadAuditQueries(AUDIT_FILES);
});
afterAll(async () => {
  await owner.end();
});

async function violationsInTx(setup: string[], p = params): Promise<string[]> {
  await owner.query('BEGIN');
  try {
    for (const s of setup) await owner.query(s);
    return (await runAudit(owner, queries, p)).map((v) => v.id);
  } finally {
    await owner.query('ROLLBACK');
  }
}

describe('KK-P03a-11 (KK-031-2, KK-032-6 kısmen): denetim sorguları', () => {
  it('audit.sql Q1–Q12 ve audit-extra.sql E1–E6 dosyalardan eksiksiz okunur (KK-P03b-22)', () => {
    expect(queries.map((q) => q.id)).toEqual([
      'Q1',
      'Q2',
      'Q3',
      'Q4',
      'Q5',
      'Q6',
      'Q7',
      'Q8',
      'Q9',
      'Q10',
      'Q11',
      'Q12',
      'E1',
      'E2',
      'E3',
      'E4',
      'E5',
      'E6',
    ]);
  });

  it('migrate sonrası her sorgu 0 satır döndürür', async () => {
    expect(await runAudit(owner, queries, params)).toEqual([]);
  });

  it('Q1/Q3: RLS ve kiracı kapısı olmayan app tablosu yakalanır', async () => {
    const t = `app.t_q1_${shortKey(newWorldKey())}`;
    const got = await violationsInTx([`CREATE TABLE ${t} (id int)`]);
    expect(got).toEqual(expect.arrayContaining(['Q1', 'Q3']));
  });

  it('Q4: K tablosunda çalışma zamanı rolüne yazma yetkisi yakalanır', async () => {
    expect(await violationsInTx(['GRANT INSERT ON app.partners TO eda_app'])).toEqual(['Q4']);
  });

  it('Q5/Q12: PUBLIC tablo yetkisi ve eda_readonly_admin rollup dışı yetki yakalanır', async () => {
    expect(await violationsInTx(['GRANT SELECT ON auth.users TO PUBLIC'])).toEqual(['Q5']);
    expect(await violationsInTx(['GRANT SELECT ON app.partners TO eda_readonly_admin'])).toEqual([
      'Q12',
    ]);
  });

  it('Q10: eda_jobs içerik kolonu yetkisi yakalanır', async () => {
    expect(await violationsInTx(['GRANT SELECT (name) ON app.partners TO eda_jobs'])).toEqual([
      'Q10',
    ]);
  });

  it('E3: yarım kalmış CONCURRENTLY (geçersiz) indeks yakalanır', async () => {
    const t = `app.t_e3_${shortKey(newWorldKey())}`;
    await owner.query(`CREATE TABLE ${t} (v int)`);
    try {
      await owner.query(`INSERT INTO ${t} VALUES (1), (1)`);
      await expect(
        owner.query(`CREATE UNIQUE INDEX CONCURRENTLY t_e3_v_uq ON ${t} (v)`),
      ).rejects.toThrow();
      const got = (await runAudit(owner, queries, params)).map((v) => v.id);
      expect(got).toContain('E3');
    } finally {
      await owner.query(`DROP TABLE ${t}`);
    }
  });

  it('E4: defter tablosunda çalışma zamanı rolü yetkisi yakalanır', async () => {
    expect(await violationsInTx(['GRANT SELECT ON public.schema_migrations TO eda_app'])).toEqual([
      'E4',
    ]);
  });

  it('E5: eda_sec_definer üzerinde tanımsız yazma yetkisi yakalanır', async () => {
    expect(
      await violationsInTx(['GRANT UPDATE (name) ON app.partners TO eda_sec_definer']),
    ).toEqual(['E5']);
    // Manifestte tanımlı kalıcı yazma yetkisi ihlal sayılmaz.
    const manifestGrants = params.definer_write_grants as readonly string[];
    const allowed = {
      ...params,
      definer_write_grants: [...manifestGrants, 'app.partners.name.UPDATE'],
    };
    expect(
      await violationsInTx(['GRANT UPDATE (name) ON app.partners TO eda_sec_definer'], allowed),
    ).toEqual([]);
  });

  it('E6: örnek büro development/test dışında yakalanır', async () => {
    const insert = `INSERT INTO auth.organizations (name, slug, metadata) VALUES ('Örnek Büro', 'org-e6-${shortKey(newWorldKey())}', '{"sampleData":true}')`;
    expect(await violationsInTx([insert], defaultAuditParams('production'))).toEqual(['E6']);
    expect(await violationsInTx([insert], defaultAuditParams('test'))).toEqual([]);
  });

  it('herhangi bir sorgu satır döndürürse migrate çıkış 50 verir', async () => {
    const scratch = await createScratch(owner);
    scratch.write([
      { name: 'schema_ok', sql: '-- eda:kind schema\nCREATE TABLE {s}.ok (id int);\n' },
    ]);
    await owner.query('GRANT SELECT ON public.schema_migrations TO eda_app');
    try {
      const log = memoryLogger();
      const code = await scratch.run(owner, log, { audit: {} });
      expect(code).toBe(EXIT.audit);
      expect(log.events('audit.violation').map((e) => e.check)).toEqual(['E4']);
    } finally {
      await owner.query('REVOKE SELECT ON public.schema_migrations FROM eda_app');
      await scratch.drop(owner);
    }
    expect(await runAudit(owner, queries, params)).toEqual([]);
  });

  it('KK-P03b-17: E1 eksik bölüm, E2 DEFAULT bölüm, Q11 bölüme yetki yakalanır', async () => {
    const ym = await owner.query<{ ym: string }>(
      `SELECT to_char(date_trunc('month', now() AT TIME ZONE 'UTC') + interval '3 months', 'YYYY_MM') AS ym`,
    );
    const last = `app.audit_log_p${ym.rows[0]?.ym}`;
    expect(await violationsInTx([`DROP TABLE ${last}`])).toEqual(['E1']);
    const def = await violationsInTx([
      `CREATE TABLE app.t_e2_${shortKey(newWorldKey())} PARTITION OF app.ai_usage DEFAULT`,
    ]);
    expect(def).toEqual(expect.arrayContaining(['E2']));
    expect(await violationsInTx([`GRANT SELECT ON ${last} TO eda_app`])).toEqual(['Q11']);
  });

  it('KK-P03b-17: RLS’siz app tablosunda migrate çıkış 50 (Q1, Q3)', async () => {
    const t = `app.t_rlssiz_${shortKey(newWorldKey())}`;
    const scratch = await createScratch(owner);
    scratch.write([
      { name: 'schema_ok', sql: '-- eda:kind schema\nCREATE TABLE {s}.ok (id int);\n' },
    ]);
    await owner.query(`CREATE TABLE ${t} (org_id uuid)`);
    try {
      const log = memoryLogger();
      expect(await scratch.run(owner, log, { audit: {} })).toBe(EXIT.audit);
      expect(log.events('audit.violation').map((e) => e.check)).toEqual(['Q1', 'Q3']);
    } finally {
      await owner.query(`DROP TABLE ${t}`);
      await scratch.drop(owner);
    }
  });

  it('KK-P03b-22 (KK-032-19): her migrate koşusunda app.ensure_partitions() çağrılır (günlük olayı)', async () => {
    const scratch = await createScratch(owner);
    scratch.write([
      { name: 'schema_ok', sql: '-- eda:kind schema\nCREATE TABLE {s}.ok (id int);\n' },
    ]);
    try {
      for (const _ of [1, 2]) {
        const log = memoryLogger();
        expect(await scratch.run(owner, log, { maintenance: true, audit: {} })).toBe(EXIT.ok);
        expect(log.events('partitions.ensured')).toHaveLength(1);
        expect(log.events('partitions.skipped')).toEqual([]);
      }
    } finally {
      await scratch.drop(owner);
    }
  });
});
