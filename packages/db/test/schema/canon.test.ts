// @tk TK-29
// Şema kanon testleri (030 Kabul Kriterleri; P03b §6): tablo kümesi, RLS bayrakları, enum CHECK
// listeleri, tip kuralları, FK öncü kolon indeksleri, Türkçe harmanlama ve korpus arama indeksleri.
// Yalnız katalog sorgusu; veri yazan tek senaryo (harmanlama sırası) geri alınan işlemdedir.
import { ORG_LIMIT_KEYS } from '@eda/contracts/api/admin-usage';
import * as auditEvents from '@eda/contracts/audit-events';
import * as enums from '@eda/contracts/enums';
import { CITATION_REASONS, MODEL_ALIASES } from '@eda/contracts/stream';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { K_TABLES, RLS_MANIFEST } from '../../src/rls/manifest.ts';
import { createTenantRunner } from '../../src/tenant.ts';
import { readTablesJson } from '../fixtures/canon-tables.ts';
import { makePool, ownerDb } from '../fixtures/db.ts';
import { newWorldKey, shortKey } from '../fixtures/ids.ts';
import { addMember, insertOrg, insertUser } from '../fixtures/tenant-world.ts';

let owner: pg.Client;
beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

const SCHEMAS = "('auth', 'app', 'corpus')";

describe('KK-P03b-1 (KK-030-1): tablo kümesi 002 §10 ile birebir', () => {
  it('auth, app ve corpus tabloları (bölümler hariç) tables.json ile eşit; auth.api_keys yok', async () => {
    const res = await owner.query<{ schema: string; name: string }>(`
      SELECT n.nspname AS schema, c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ${SCHEMAS} AND c.relkind IN ('r', 'p') AND NOT c.relispartition
      ORDER BY 1, 2`);
    const live = { auth: [] as string[], app: [] as string[], corpus: [] as string[] };
    for (const r of res.rows) live[r.schema as keyof typeof live].push(r.name);
    const canon = readTablesJson();
    expect(live.auth).toEqual(canon.auth.filter((t) => t !== 'api_keys'));
    expect(live.app).toEqual([...canon.app]);
    expect(live.corpus).toEqual([...canon.corpus]);
  });
});

describe('KK-P03b-2 (KK-030-2): RLS bayrakları', () => {
  it('E (kiracı/kullanıcı) tablolarında ENABLE + FORCE; K/— tabloları dışında RLS’siz app tablosu yok', async () => {
    const res = await owner.query<{ name: string; rls: boolean; force: boolean; org: boolean }>(`
      SELECT c.relname AS name, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
             EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id'
                     AND NOT a.attisdropped) AS org
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relkind IN ('r', 'p') AND NOT c.relispartition`);
    for (const r of res.rows) {
      const m = RLS_MANIFEST[r.name];
      expect(m, `manifestte yok: ${r.name}`).toBeDefined();
      const isRls = m?.class === 'tenant' || m?.class === 'user';
      expect({ rls: r.rls, force: r.force }, r.name).toEqual({ rls: isRls, force: isRls });
      if (r.org && !isRls) expect(K_TABLES, r.name).toContain(r.name);
    }
    expect(res.rows.length).toBe(Object.keys(RLS_MANIFEST).length);
  });
});

/** Kanonik dizi adayları: enums.ts + diğer @eda/contracts kümeleri (takma ad, atıf nedeni, denetim olayı). */
const CANDIDATES: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>([
  ...(Object.entries(enums) as [string, unknown][]).filter((e): e is [string, readonly string[]] =>
    Array.isArray(e[1]),
  ),
  ['MODEL_ALIASES', MODEL_ALIASES],
  ['CITATION_REASONS', CITATION_REASONS],
  ['ORG_LIMIT_KEYS', ORG_LIMIT_KEYS],
  ['AUDIT_ACTIONS', auditEvents.AUDIT_ACTIONS],
  ['MEMBER_ROLES-owner', enums.MEMBER_ROLES.filter((r) => r !== 'owner')],
]);

describe('KK-P03b-3 (KK-030-3), KK-P03b-24 (KK-002-5, KK-002-10): enum = text + CHECK', () => {
  it('üç şemada PG enum tipi yok', async () => {
    const res = await owner.query(`
      SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typtype = 'e' AND n.nspname IN ${SCHEMAS}`);
    expect(res.rows).toEqual([]);
  });

  it('her enum CHECK listesi bir @eda/contracts dizisine birebir eşittir (anlık görüntü)', async () => {
    const res = await owner.query<{ key: string; def: string }>(`
      SELECT n.nspname || '.' || c.relname || '.' || k.conname AS key, pg_get_constraintdef(k.oid) AS def
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE k.contype = 'c' AND n.nspname IN ${SCHEMAS} AND NOT c.relispartition
        AND k.conname LIKE '%\\_chk'
        AND (pg_get_constraintdef(k.oid) ~ '^CHECK \\(\\(?[a-z_]+ = ANY \\(ARRAY\\[' OR
             pg_get_constraintdef(k.oid) ~ '^CHECK \\(\\(?[a-z_]+ <@ ARRAY\\[')`);
    const mapping: Record<string, string> = {};
    for (const r of res.rows) {
      const values = [...r.def.matchAll(/'([^']+)'::text/g)].map((m) => m[1] ?? '');
      if (values.length === 0) continue; // sayısal liste (ör. rating IN (-1, 1)) enum değildir
      const names = [...CANDIDATES]
        .filter(([, arr]) => arr.length === values.length && arr.every((v, i) => v === values[i]))
        .map(([n]) => n)
        .sort();
      expect(names.length, `${r.key}: ${values.join(',')}`).toBeGreaterThan(0);
      mapping[r.key] = names.join('|');
    }
    // audit_log.action CHECK'i AUDIT_ACTIONS dizisinden üretilmiştir (KK-P03b-24).
    expect(mapping['app.audit_log.audit_log_action_chk']).toBe('AUDIT_ACTIONS');
    await expect(
      `${JSON.stringify(Object.fromEntries(Object.entries(mapping).sort()), null, 2)}\n`,
    ).toMatchFileSnapshot('../fixtures/enum-checks.snap.json');
  });
});

describe('KK-P03b-4 (KK-030-4): tip kuralları', () => {
  it('zaman dilimsiz zaman, real, double precision, numeric, varchar kolonu yok', async () => {
    const res = await owner.query(`
      SELECT table_schema, table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema IN ${SCHEMAS}
        AND data_type IN ('timestamp without time zone', 'real', 'double precision', 'numeric',
                          'character varying')`);
    expect(res.rows).toEqual([]);
  });

  it('_kurus, _micro_usd ve _micro_usd_per_mtok sonekli kolonların tamamı bigint', async () => {
    const res = await owner.query<{ col: string; type: string }>(`
      SELECT table_schema || '.' || table_name || '.' || column_name AS col, data_type AS type
      FROM information_schema.columns
      WHERE table_schema IN ${SCHEMAS}
        AND (column_name ~ '_kurus$' OR column_name ~ '_micro_usd$' OR column_name ~ '_micro_usd_per_mtok$')`);
    expect(res.rows.length).toBeGreaterThan(10);
    for (const r of res.rows) expect(r.type, r.col).toBe('bigint');
  });

  it('KK-030-5: id adlı uuid PK varsayılanı uuidv7() (tek istisna auth.invitations)', async () => {
    const res = await owner.query<{ tbl: string; def: string | null }>(`
      SELECT n.nspname || '.' || c.relname AS tbl, pg_get_expr(d.adbin, d.adrelid) AS def
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.conkey[1]
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE k.contype = 'p' AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype
        AND n.nspname IN ${SCHEMAS} AND NOT c.relispartition`);
    expect(res.rows.length).toBeGreaterThanOrEqual(80);
    for (const r of res.rows)
      expect(r.def, r.tbl).toBe(r.tbl === 'auth.invitations' ? 'gen_random_uuid()' : 'uuidv7()');
  });
});

describe('KK-P03b-14 (KK-030-17): FK öncü kolon indeksi', () => {
  it('katalog FK’leri dışında her FK’yi öncü kolonlarıyla kapsayan (veya tekil alt küme) indeks var', async () => {
    const catalogs = K_TABLES.filter((t) => RLS_MANIFEST[t]?.class === 'catalog').map(
      (t) => `app.${t}`,
    );
    const res = await owner.query<{ tbl: string; conname: string }>(
      `SELECT f.conrelid::regclass::text AS tbl, f.conname
       FROM pg_constraint f JOIN pg_namespace n ON n.oid = f.connamespace
       WHERE f.contype = 'f' AND n.nspname IN ${SCHEMAS}
         AND f.confrelid::regclass::text <> ALL ($1::text[])
         AND NOT EXISTS (
           SELECT 1 FROM pg_index i WHERE i.indrelid = f.conrelid AND (
             (SELECT array_agg(k ORDER BY k) FROM unnest((i.indkey::int2[])[0:cardinality(f.conkey) - 1]) k)
               = (SELECT array_agg(k ORDER BY k) FROM unnest(f.conkey) k)
             OR (i.indisunique AND i.indpred IS NULL AND (i.indkey::int2[]) <@ f.conkey)))
       ORDER BY 1, 2`,
      [catalogs],
    );
    expect(res.rows).toEqual([]);
  });
});

/** 030 §14 tr-TR-x-icu kolonları. */
const TR_COLUMNS = [
  'app.case_parties.display_name',
  'app.case_types.name',
  'app.cases.title',
  'app.chambers.name',
  'app.clients.display_name',
  'app.conversations.title',
  'app.courts.name',
  'app.documents.title',
  'app.partners.name',
  'app.prompt_library.title',
  'app.templates.title',
  'auth.organizations.name',
  'auth.users.name',
  'corpus.laws.title',
];

describe('KK-P03b-11 (KK-030-14): Türkçe sıralama ve C kolonları', () => {
  it('tr-TR-x-icu yalnız 030 §14 listesindeki kolonlarda; email ve esas_no varsayılan (C.UTF-8)', async () => {
    const res = await owner.query<{ col: string; coll: string }>(`
      SELECT n.nspname || '.' || c.relname || '.' || a.attname AS col, co.collname AS coll
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_collation co ON co.oid = a.attcollation
      WHERE n.nspname IN ${SCHEMAS} AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND a.attnum > 0 AND NOT a.attisdropped AND a.attcollation NOT IN (0, 100)`);
    expect(res.rows.map((r) => r.col).sort()).toEqual(TR_COLUMNS);
    for (const r of res.rows) expect(r.coll, r.col).toBe('tr-TR-x-icu');
    const c = await owner.query<{ col: string; coll: number }>(`
      SELECT c.relname || '.' || a.attname AS col, a.attcollation::int AS coll
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = 'app'::regnamespace AND a.attname IN ('email', 'esas_no')
        AND NOT c.relispartition AND c.relkind IN ('r', 'p')`);
    expect(c.rows.length).toBeGreaterThanOrEqual(3);
    for (const r of c.rows) expect(r.coll, r.col).toBe(100);
    const db = await owner.query<{ datcollate: string }>(
      'SELECT datcollate FROM pg_database WHERE datname = current_database()',
    );
    expect(db.rows[0]?.datcollate).toBe('C.UTF-8');
  });

  it('ORDER BY display_name: Cem, Çelik, Dede, Ilgaz, İnce (app.clients üretilmiş kolon)', async () => {
    const key = shortKey(newWorldKey());
    const org = await insertOrg(owner, key, 'Sıralama Bürosu');
    const user = await insertUser(owner, key, 'siralama');
    await addMember(owner, org, user, 'owner');
    const pool = makePool('eda_owner', 1);
    try {
      const names = await createTenantRunner(pool).withTenant(
        { orgId: org, userId: user },
        async (tx) => {
          for (const first of ['İnce', 'Cem', 'Ilgaz', 'Dede', 'Çelik']) {
            await tx.query(
              `INSERT INTO app.clients (org_id, kind, first_name, last_name, name_fold, created_by)
             VALUES ($1, 'person', $2, 'Örnek', 'ornek', $3)`,
              [org, first, user],
            );
          }
          const res = await tx.query<{ display_name: string }>(
            'SELECT display_name FROM app.clients WHERE org_id = $1 ORDER BY display_name',
            [org],
          );
          return res.rows.map((r) => r.display_name);
        },
      );
      expect(names).toEqual([
        'Cem Örnek',
        'Çelik Örnek',
        'Dede Örnek',
        'Ilgaz Örnek',
        'İnce Örnek',
      ]);
    } finally {
      await pool.end();
    }
  });
});

describe('KK-P03b-10 (KK-030-12): korpus arama indeksleri', () => {
  it('HNSW yalnız corpus chunk tablolarında (halfvec_cosine_ops, m=16, ef_construction=64)', async () => {
    const res = await owner.query<{ tbl: string; def: string }>(`
      SELECT i.indrelid::regclass::text AS tbl, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam
      WHERE am.amname = 'hnsw' ORDER BY 1`);
    expect(res.rows.map((r) => r.tbl)).toEqual([
      'corpus.decision_chunks',
      'corpus.law_article_chunks',
    ]);
    for (const r of res.rows) {
      expect(r.def).toContain('halfvec_cosine_ops');
      expect(r.def).toContain("m='16'");
      expect(r.def).toContain("ef_construction='64'");
    }
  });

  it('BM25 yalnız corpus.decision_sections ve corpus.law_articles; text_config public.tr_hukuk', async () => {
    const res = await owner.query<{ tbl: string; def: string }>(`
      SELECT i.indrelid::regclass::text AS tbl, pg_get_indexdef(i.indexrelid) AS def
      FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid JOIN pg_am am ON am.oid = ic.relam
      WHERE am.amname = 'bm25' ORDER BY 1`);
    expect(res.rows.map((r) => r.tbl)).toEqual(['corpus.decision_sections', 'corpus.law_articles']);
    for (const r of res.rows) expect(r.def).toContain("text_config='public.tr_hukuk'");
  });

  it('app şemasında HNSW, BM25 veya ivfflat indeksi yok; file_chunks yalnız tsvector GIN', async () => {
    const res = await owner.query(`
      SELECT ic.relname FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam JOIN pg_class t ON t.oid = i.indrelid
      WHERE t.relnamespace = 'app'::regnamespace AND am.amname IN ('hnsw', 'bm25', 'ivfflat')`);
    expect(res.rows).toEqual([]);
  });
});
