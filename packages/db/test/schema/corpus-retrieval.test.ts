// @tk TK-17
// P14a canlı veritabanı doğrulamaları (TEST yığını): KK-P14a-2 (KK-023-2) TS `tr_fold` ↔ DB `translate`,
// KK-P14a-3 (KK-023-3) `ts_debug` leksemleri, KK-P14a-5 (KK-023-5, KK-023-8 şema yarısı), KK-P14a-14
// (KK-034-26) 034 §3.4 uyum DDL'i ve pg_textsearch söz dizimi, KK-P14a-15 korpus yetkileri. 034 §3.4
// kolonları P03b'de 0019/0022 ile kurulmuştur; P14a yeni migrasyon gerektirmedi. Veri yazan
// senaryolar geri alınan işlemdedir; metinler sentetiktir.
import { readFileSync } from 'node:fs';
import { tr_fold, tr_normalize } from '@eda/legal/text';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ownerDb } from '../fixtures/db.ts';

let owner: pg.Client;
beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

async function rolledBack<T>(fn: () => Promise<T>): Promise<T> {
  await owner.query('BEGIN');
  try {
    return await fn();
  } finally {
    await owner.query('ROLLBACK');
  }
}

/** Belirlenimci üreteç (LCG); Türkçe harf, büyük harf ve tipografik işaret içeren örnek metin. */
function samples(n: number, seed: number): string[] {
  const alphabet = [
    ...'abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ0123456789',
    ' ',
    ' ',
    '.',
    '/',
    '’',
    'â',
    'Î',
    '–',
    'md.',
    'S.K.',
  ];
  let s = seed >>> 0;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return Array.from({ length: n }, () =>
    Array.from(
      { length: 1 + Math.floor(next() * 40) },
      () => alphabet[Math.floor(next() * alphabet.length)],
    ).join(''),
  );
}

describe('KK-P14a-2 / KK-023-2: TS tr_fold ile DB translate birebir eşit', () => {
  it('1.000 örnekte geçici tabloda üretilmiş kolon = tr_fold(x)', async () => {
    const xs = samples(1000, 20261011);
    const folded = await rolledBack(async () => {
      await owner.query(`CREATE TEMP TABLE fold_probe (
        n int, text_norm text,
        text_fold text GENERATED ALWAYS AS (translate(text_norm, 'çğıöşü', 'cgiosu')) STORED
      ) ON COMMIT DROP`);
      await owner.query(
        'INSERT INTO fold_probe (n, text_norm) SELECT n, t FROM unnest($1::text[]) WITH ORDINALITY AS u(t, n)',
        [xs.map(tr_normalize)],
      );
      const r = await owner.query<{ text_fold: string }>(
        'SELECT text_fold FROM fold_probe ORDER BY n',
      );
      return r.rows.map((row) => row.text_fold);
    });
    expect(folded).toEqual(xs.map(tr_fold));
  });

  it('corpus.decision_sections.text_fold ve fold_tsv aynı eşlemeyi kullanır', async () => {
    const row = await rolledBack(async () => {
      const d = await owner.query<{ id: string }>(`
        INSERT INTO corpus.decisions (source, document_id, origin, court_name, court_type,
          kunye_norm, kunye_fold, retrieved_at)
        VALUES ('bedesten', 'ornek-fold-1', 'live', 'Yargıtay', 'yargitay', 'k', 'k', now())
        RETURNING id`);
      const text = 'İŞÇİNİN Kıdem Tazminatı ÖDENMEMİŞTİR';
      await owner.query(
        `INSERT INTO corpus.decision_sections (decision_id, section_no, role, text, text_norm, court_type)
         VALUES ($1, 1, 'gerekce', $2, $3, 'yargitay')`,
        [d.rows[0]?.id, text, tr_normalize(text)],
      );
      const r = await owner.query<{ text_fold: string; tsv: string }>(
        'SELECT text_fold, fold_tsv::text AS tsv FROM corpus.decision_sections WHERE decision_id = $1',
        [d.rows[0]?.id],
      );
      return { ...r.rows[0], expected: tr_fold(text) };
    });
    expect(row.text_fold).toBe(row.expected);
    expect(row.tsv).toBe("'iscinin':1 'kidem':2 'odenmemistir':4 'tazminati':3");
  });
});

type TsDebugFixture = { rows: { input: string; lexemes: string[][] }[] };
const TSDEBUG = JSON.parse(
  readFileSync(
    new URL('../../../legal/test/fixtures/tr-hukuk-tsdebug.json', import.meta.url),
    'utf8',
  ),
) as TsDebugFixture;

describe('KK-P14a-3 / KK-023-3: ts_debug(public.tr_hukuk) leksemleri (023 §3.6)', () => {
  for (const row of TSDEBUG.rows) {
    it(row.input, async () => {
      const r = await owner.query<{ lexemes: string[] | null }>(
        `SELECT d.lexemes FROM ts_debug('public.tr_hukuk', $1)
           WITH ORDINALITY AS d(alias, description, token, dictionaries, dictionary, lexemes, n)
         WHERE d.alias <> 'blank' ORDER BY d.n`,
        [row.input],
      );
      expect(r.rows.map((x) => x.lexemes ?? [])).toEqual(row.lexemes);
    });
  }
});

describe('KK-P14a-5 / KK-023-5 / KK-023-8: bm25 yalnız corpus; app.file_chunks vektör indekssiz', () => {
  it('app ve auth şemasında bm25 erişim yöntemli indeks yok', async () => {
    const r = await owner.query(`
      SELECT ic.relname FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam JOIN pg_class t ON t.oid = i.indrelid
      WHERE t.relnamespace IN ('app'::regnamespace, 'auth'::regnamespace) AND am.amname = 'bm25'`);
    expect(r.rows).toEqual([]);
  });

  it('app.file_chunks üzerinde hnsw / ivfflat yok', async () => {
    const r = await owner.query(`
      SELECT ic.relname FROM pg_index i JOIN pg_class ic ON ic.oid = i.indexrelid
      JOIN pg_am am ON am.oid = ic.relam
      WHERE i.indrelid = 'app.file_chunks'::regclass AND am.amname IN ('hnsw', 'ivfflat')`);
    expect(r.rows).toEqual([]);
  });
});

describe('KK-P14a-14 / KK-034-26: corpus uyum DDL şeması (034 §3.4)', () => {
  const COLUMNS: Record<string, string[]> = {
    decisions: [
      'court_type',
      'kunye_hash',
      'withdrawn_at',
      'withdrawn_reason',
      'sectioning_version',
      'chunking_version',
    ],
    decision_sections: ['court_type', 'chamber_code', 'decision_date', 'text_fold', 'fold_tsv'],
    decision_chunks: ['court_type', 'chamber_code', 'decision_date', 'char_start', 'char_end'],
    laws: ['aliases'],
    law_articles: ['text_fold', 'fold_tsv'],
    embed_staging: ['chunk_id', 'kind', 'emb', 'embed_model_revision'],
  };

  it('kolonlar var; court_type ve parça ofsetleri NOT NULL; fold kolonları üretilmiş', async () => {
    const r = await owner.query<{ t: string; c: string; nullable: string; generated: string }>(`
      SELECT table_name AS t, column_name AS c, is_nullable AS nullable, is_generated AS generated
      FROM information_schema.columns WHERE table_schema = 'corpus'`);
    const has = (t: string, c: string) => r.rows.find((x) => x.t === t && x.c === c);
    for (const [t, cols] of Object.entries(COLUMNS)) {
      for (const c of cols) expect(has(t, c), `${t}.${c}`).toBeDefined();
    }
    for (const t of ['decisions', 'decision_sections', 'decision_chunks']) {
      expect(has(t, 'court_type')?.nullable, t).toBe('NO');
    }
    expect(has('decision_chunks', 'char_start')?.nullable).toBe('NO');
    expect(has('decision_chunks', 'char_end')?.nullable).toBe('NO');
    for (const t of ['decision_sections', 'law_articles']) {
      expect(has(t, 'text_fold')?.generated, t).toBe('ALWAYS');
      expect(has(t, 'fold_tsv')?.generated, t).toBe('ALWAYS');
    }
  });

  it('getirim indeksleri 030 adlarıyla; BM25 kısmi ve public.tr_hukuk', async () => {
    const r = await owner.query<{ name: string; def: string }>(`
      SELECT c.relname AS name, pg_get_indexdef(c.oid) AS def FROM pg_class c
      WHERE c.relkind = 'i' AND c.relnamespace = 'corpus'::regnamespace`);
    const def = (n: string) => r.rows.find((x) => x.name === n)?.def ?? '';
    for (const n of [
      'decisions_kunye_hash_idx',
      'decisions_court_type_date_idx',
      'decision_chunks_filter_idx',
      'decision_chunks_decision_idx',
      'decision_chunks_pending_idx',
      'decision_chunks_hnsw_idx',
      'decision_sections_fold_tsv_idx',
      'law_articles_fold_tsv_idx',
      'law_articles_bm25_idx',
    ]) {
      expect(def(n), n).not.toBe('');
    }
    expect(def('decision_chunks_pending_idx')).toContain('WHERE (emb IS NULL)');
    expect(def('decision_sections_bm25_idx')).toBe(
      "CREATE INDEX decision_sections_bm25_idx ON corpus.decision_sections USING bm25 (text_norm) WITH (text_config='public.tr_hukuk') WHERE (role <> 'kunye'::text)",
    );
  });

  it('law_articles.article_no CHECK M önekini kabul eder, biçim dışını reddeder', async () => {
    await rolledBack(async () => {
      const law = await owner.query<{ id: string }>(
        `INSERT INTO corpus.laws (law_no, title, title_fold) VALUES ('99001', 'Örnek Kanun', 'ornek kanun') RETURNING id`,
      );
      const id = law.rows[0]?.id;
      for (const [k, key] of ['49', '49/A', 'G5', 'E3', 'M18'].entries()) {
        await owner.query(
          `INSERT INTO corpus.law_articles (law_id, article_no, text, text_norm, sort_order)
           VALUES ($1, $2, '[ÖRNEK METİN]', '[örnek metin]', $3)`,
          [id, key, k],
        );
      }
      await owner.query('SAVEPOINT bad');
      await expect(
        owner.query(
          `INSERT INTO corpus.law_articles (law_id, article_no, text, text_norm, sort_order)
           VALUES ($1, 'X1', 'x', 'x', 99)`,
          [id],
        ),
      ).rejects.toThrow(/law_articles_article_no_chk/);
      await owner.query('ROLLBACK TO SAVEPOINT bad');
    });
  });

  it('pg_textsearch söz dizimi kurulu sürümde çalışır: kısmi BM25 indeks taraması, kunye hariç', async () => {
    const out = await rolledBack(async () => {
      const d = await owner.query<{ id: string }>(`
        INSERT INTO corpus.decisions (source, document_id, origin, court_name, court_type,
          kunye_norm, kunye_fold, retrieved_at)
        VALUES ('bedesten', 'ornek-bm25-1', 'live', 'Yargıtay', 'yargitay', 'k', 'k', now())
        RETURNING id`);
      const rows: [number, string, string][] = [
        [1, 'kunye', 'kıdem kıdem kıdem'],
        [2, 'gerekce', 'kıdem tazminatı hesaplanır'],
        [3, 'hukum', 'davanın reddine'],
      ];
      for (const [no, role, text] of rows) {
        await owner.query(
          `INSERT INTO corpus.decision_sections (decision_id, section_no, role, text, text_norm, court_type)
           VALUES ($1, $2, $3, $4, $4, 'yargitay')`,
          [d.rows[0]?.id, no, role, text],
        );
      }
      await owner.query('SET LOCAL enable_seqscan = off');
      const q = `SELECT section_no FROM corpus.decision_sections WHERE role <> 'kunye'
        ORDER BY text_norm <@> to_bm25query($1, 'corpus.decision_sections_bm25_idx') LIMIT 5`;
      const plan = await owner.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF) ${q}`, [
        'kıdem tazminatı',
      ]);
      const res = await owner.query<{ section_no: number }>(q, ['kıdem tazminatı']);
      return {
        plan: plan.rows.map((x) => x['QUERY PLAN']).join('\n'),
        nos: res.rows.map((x) => x.section_no),
      };
    });
    expect(out.plan).toContain('Index Scan using decision_sections_bm25_idx');
    expect(out.nos).toEqual([2]);
  });
});

describe('KK-P14a-15: corpus yetkileri ve kiracısızlık (031 §2.3, 034 §3.1)', () => {
  it('eda_app embed_staging yazamaz, okur; eda_worker yazar', async () => {
    const r = await owner.query<{ role: string; priv: string; ok: boolean }>(`
      SELECT r AS role, p AS priv, has_table_privilege(r, 'corpus.embed_staging', p) AS ok
      FROM unnest(ARRAY['eda_app', 'eda_worker']) r, unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p`);
    const ok = (role: string, priv: string) =>
      r.rows.find((x) => x.role === role && x.priv === priv)?.ok;
    expect(ok('eda_app', 'SELECT')).toBe(true);
    for (const p of ['INSERT', 'UPDATE', 'DELETE']) {
      expect(ok('eda_app', p), p).toBe(false);
      expect(ok('eda_worker', p), p).toBe(true);
    }
  });

  it('corpus tablolarında RLS yok, org_id / user_id kolonu yok', async () => {
    const rls = await owner.query(`
      SELECT relname FROM pg_class WHERE relnamespace = 'corpus'::regnamespace AND relkind = 'r'
        AND (relrowsecurity OR relforcerowsecurity)`);
    expect(rls.rows).toEqual([]);
    const cols = await owner.query(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE table_schema = 'corpus' AND column_name IN ('org_id', 'user_id')`);
    expect(cols.rows).toEqual([]);
  });
});
