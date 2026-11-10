// @tk TK-29
// KK-P03a-18, KK-P03b-15 (KK-030-18): Drizzle şeması ile canlı şema arasında fark yok. El yazımı
// nesneler (kolon harmanlaması, kolon yetkileri) karşılaştırma dışıdır (030 §1.9).
import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/schema/index.ts';
import { ownerDb } from '../fixtures/db.ts';

let owner: pg.Client;
beforeAll(async () => {
  owner = await ownerDb();
});
afterAll(async () => {
  await owner.end();
});

/** Drizzle tip adı -> format_type() biçimi (yalnız yazım farkı olanlar). */
const sqlType = (t: string): string => (t === 'time' ? 'time without time zone' : t);

const tables: PgTable[] = (Object.values(schema) as unknown[]).filter((v): v is PgTable =>
  is(v, PgTable),
);

describe('KK-P03a-18 KK-P03b-15: Drizzle şeması ↔ canlı şema', () => {
  it('şemadaki tablo sayısı canlı auth + app + corpus tablolarına eşit (bölümler hariç)', async () => {
    const res = await owner.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname IN ('auth', 'app', 'corpus') AND c.relkind IN ('r', 'p') AND NOT c.relispartition`,
    );
    expect(tables.length).toBe(Number(res.rows[0]?.n));
  });

  for (const table of tables) {
    const cfg = getTableConfig(table);
    const qualified = `${cfg.schema}.${cfg.name}`;
    it(`${qualified}: kolon adı, tipi ve NOT NULL; CHECK, UNIQUE ve indeks adları`, async () => {
      const cols = await owner.query<{ name: string; type: string; notnull: boolean }>(
        `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull AS notnull
         FROM pg_attribute a WHERE a.attrelid = $1::regclass AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum`,
        [qualified],
      );
      const live = new Map(cols.rows.map((c) => [c.name, c]));
      expect([...live.keys()].sort()).toEqual(cfg.columns.map((c) => c.name).sort());
      for (const c of cfg.columns) {
        expect(live.get(c.name)?.type, `${qualified}.${c.name}`).toBe(sqlType(c.getSQLType()));
        expect(live.get(c.name)?.notnull, `${qualified}.${c.name}`).toBe(c.notNull);
      }
      const cons = await owner.query<{ conname: string; contype: string }>(
        'SELECT conname, contype FROM pg_constraint WHERE conrelid = $1::regclass',
        [qualified],
      );
      const names = new Set(cons.rows.map((r) => r.conname));
      for (const ch of cfg.checks) expect(names.has(ch.name), ch.name).toBe(true);
      for (const u of cfg.uniqueConstraints)
        expect(names.has(u.getName() ?? ''), u.getName()).toBe(true);
      expect(cons.rows.filter((r) => r.contype === 'c').length).toBe(cfg.checks.length);
      expect(cons.rows.filter((r) => r.contype === 'f').length).toBe(cfg.foreignKeys.length);
      const idx = await owner.query<{ indexname: string }>(
        'SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = $2',
        [cfg.schema, cfg.name],
      );
      const liveIdx = new Set(idx.rows.map((r) => r.indexname));
      for (const i of cfg.indexes)
        expect(liveIdx.has(i.config.name ?? ''), i.config.name).toBe(true);
    });
  }
});
