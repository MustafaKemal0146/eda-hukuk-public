// @tk TK-01
// RLS manifesti ↔ canlı şema (031 §14; KK-031-14, KK-032-7): app tablo kümesi, politika adları,
// tablo ve kolon düzeyi yetkiler birebir eşleşir. Eksik veya fazla politika/yetki testi kırar.
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GRANTEE_ROLES, grantsOf, MANIFEST_TABLES, RLS_MANIFEST } from '../../src/rls/manifest.ts';
import { ownerDb } from '../fixtures/db.ts';

let owner: pg.Client;
beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

interface LiveState {
  readonly tables: string[];
  readonly policies: string[];
  readonly tableGrants: string[];
  readonly columnGrants: string[];
}

async function live(client: pg.Client): Promise<LiveState> {
  const tables = await client.query<{ t: string }>(`
    SELECT c.relname AS t FROM pg_class c
    WHERE c.relnamespace = 'app'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    ORDER BY 1`);
  const policies = await client.query<{ p: string }>(`
    SELECT tablename || '.' || policyname AS p FROM pg_policies WHERE schemaname = 'app' ORDER BY 1`);
  const tableGrants = await client.query<{ g: string }>(`
    SELECT c.relname || ':' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END
           || ':' || a.privilege_type AS g
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
    WHERE c.relnamespace = 'app'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      AND a.grantee <> c.relowner
    ORDER BY 1`);
  const columnGrants = await client.query<{ g: string }>(`
    SELECT c.relname || '.' || at.attname || ':' ||
           CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END || ':' || a.privilege_type AS g
    FROM pg_class c
    JOIN pg_attribute at ON at.attrelid = c.oid AND at.attnum > 0 AND NOT at.attisdropped
    CROSS JOIN LATERAL aclexplode(at.attacl) a
    WHERE c.relnamespace = 'app'::regnamespace AND c.relkind IN ('r', 'p') AND NOT c.relispartition
    ORDER BY 1`);
  return {
    tables: tables.rows.map((r) => r.t),
    policies: policies.rows.map((r) => r.p),
    tableGrants: tableGrants.rows.map((r) => r.g),
    columnGrants: columnGrants.rows.map((r) => r.g),
  };
}

function expected(): LiveState {
  const policies: string[] = [];
  const tableGrants: string[] = [];
  const columnGrants: string[] = [];
  for (const t of MANIFEST_TABLES) {
    for (const p of RLS_MANIFEST[t]?.policies ?? []) policies.push(`${t}.${p}`);
    const g = grantsOf(t);
    for (const role of GRANTEE_ROLES) {
      const r = g[role];
      if (r === undefined) continue;
      for (const priv of r.table ?? []) tableGrants.push(`${t}:${role}:${priv}`);
      if (r.delete) tableGrants.push(`${t}:${role}:DELETE`);
      for (const c of r.select ?? []) columnGrants.push(`${t}.${c}:${role}:SELECT`);
      for (const c of r.insert ?? []) columnGrants.push(`${t}.${c}:${role}:INSERT`);
      for (const c of r.update ?? []) columnGrants.push(`${t}.${c}:${role}:UPDATE`);
    }
  }
  const sort = (a: string[]) => [...new Set(a)].sort();
  return {
    tables: [...MANIFEST_TABLES],
    policies: sort(policies),
    tableGrants: sort(tableGrants),
    columnGrants: sort(columnGrants),
  };
}

/** İki durum arasındaki farklar (eksik: manifestte var canlıda yok; fazla: tersi). */
function diff(a: LiveState, b: LiveState): Record<string, { eksik: string[]; fazla: string[] }> {
  const out: Record<string, { eksik: string[]; fazla: string[] }> = {};
  for (const k of ['tables', 'policies', 'tableGrants', 'columnGrants'] as const) {
    const live = new Set(a[k]);
    const want = new Set(b[k]);
    const eksik = [...want].filter((x) => !live.has(x));
    const fazla = [...live].filter((x) => !want.has(x));
    if (eksik.length || fazla.length) out[k] = { eksik, fazla };
  }
  return out;
}

describe('KK-P03b-21 (KK-031-14, KK-032-7): manifest canlı şemayla birebir', () => {
  it('app tablo kümesi, politika adları, tablo ve kolon yetkileri manifestle eşit', async () => {
    expect(diff(await live(owner), expected())).toEqual({});
  });

  it('manifestte olmayan app tablosu, fazla politika ve fazla/eksik yetki farkı yakalanır', async () => {
    await owner.query('BEGIN');
    try {
      await owner.query('CREATE TABLE app.t_manifest_disi (id int)');
      await owner.query('CREATE POLICY cases_fazla ON app.cases FOR SELECT USING (false)');
      await owner.query('GRANT SELECT (title) ON app.cases TO eda_jobs');
      await owner.query('REVOKE SELECT ON app.courts FROM eda_app');
      const d = diff(await live(owner), expected());
      expect(d.tables?.fazla).toEqual(['t_manifest_disi']);
      expect(d.policies?.fazla).toEqual(['cases.cases_fazla']);
      expect(d.columnGrants?.fazla).toEqual(['cases.title:eda_jobs:SELECT']);
      expect(d.tableGrants?.eksik).toEqual(['courts:eda_app:SELECT']);
    } finally {
      await owner.query('ROLLBACK');
    }
  });

  it('PUBLIC hiçbir app tablosunda ve kolonunda yetki almaz', async () => {
    const s = await live(owner);
    expect([...s.tableGrants, ...s.columnGrants].filter((g) => g.includes(':PUBLIC:'))).toEqual([]);
  });
});
