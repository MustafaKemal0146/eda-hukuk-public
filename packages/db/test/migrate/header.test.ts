// @tk TK-29
// Başlık direktifleri, defter doğrulaması ve denetim dosyası bölme (032 §4.2–§4.4, §6.5). Ağsız.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAuditQueries, splitAuditFile } from '../../src/migrate/audit.ts';
import { EXIT, MigrateError } from '../../src/migrate/exit-codes.ts';
import {
  HeaderError,
  parseDurationMs,
  parseHeader,
  splitStatements,
} from '../../src/migrate/header.ts';
import { AUDIT_FILES, DEFAULT_SETTINGS } from '../../src/migrate/index.ts';
import { drizzleJournalSource, type MigrationEntry, sha256 } from '../../src/migrate/journal.ts';
import { verifyLedger } from '../../src/migrate/runner.ts';

const defaults = {
  batchSize: DEFAULT_SETTINGS.backfillBatchSize,
  sleepMs: DEFAULT_SETTINGS.backfillBatchSleepMs,
};

describe('KK-P03a-5: başlık direktifleri (032 §4.2)', () => {
  it('tüm direktifler ayrıştırılır; ilk SQL deyiminden sonrası okunmaz', () => {
    const h = parseHeader(
      [
        '-- eda:kind index',
        '-- açıklama satırı',
        '-- eda:lock-timeout 5s',
        '-- eda:statement-timeout 30min',
        '-- eda:no-transaction',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS x ON app.t (a);',
        '-- eda:destructive sonradan gelen direktif okunmaz',
      ].join('\n'),
      defaults,
    );
    expect(h).toEqual({
      kind: 'index',
      lockTimeoutMs: 5000,
      statementTimeoutMs: 1_800_000,
      noTransaction: true,
    });
  });

  it('backfill-batched hedefi, yığın ve bekleme; $db anahtarları varsayılana çözülür', () => {
    const h = parseHeader(
      '-- eda:kind backfill\n-- eda:backfill-batched app.cases(visibility) batch=$db.backfillBatchSize sleep=10ms\nUPDATE app.cases SET visibility = 1;\n',
      defaults,
    );
    expect(h.backfill).toEqual({
      batched: true,
      schema: 'app',
      table: 'cases',
      columns: ['visibility'],
      insert: false,
      batchSize: defaults.batchSize,
      sleepMs: 10,
    });
  });

  it('geçersiz başlıklar reddedilir', () => {
    const bad = [
      'CREATE TABLE app.t (id int);',
      '-- eda:kind tablo\nSELECT 1;',
      '-- eda:kind schema\n-- eda:bilinmeyen\nSELECT 1;',
      '-- eda:kind schema\n-- eda:kind schema\nSELECT 1;',
      '-- eda:kind schema\n-- eda:statement-timeout 2h\nSELECT 1;',
      '-- eda:kind schema\n-- eda:backfill app.cases(visibility)\nSELECT 1;',
      '-- eda:kind backfill\n-- eda:backfill app.cases(org_id)\nSELECT 1;',
      '-- eda:kind backfill\n-- eda:backfill app.cases(visibility) batch=10\nSELECT 1;',
    ];
    for (const sql of bad) expect(() => parseHeader(sql, defaults), sql).toThrow(HeaderError);
  });

  it('süre biçimleri ve işlemsiz dosya bölme', () => {
    expect([
      parseDurationMs('250ms'),
      parseDurationMs('2s'),
      parseDurationMs('10min'),
      parseDurationMs('1h'),
      parseDurationMs('700'),
    ]).toEqual([250, 2000, 600_000, 3_600_000, 700]);
    expect(
      splitStatements(
        '-- eda:kind index\nA;\n--> statement-breakpoint\n\n--> statement-breakpoint\nB;',
      ),
    ).toEqual(['-- eda:kind index\nA;', 'B;']);
  });
});

const entry = (seq: number, id: string, data: string | null): MigrationEntry => ({
  id,
  seq,
  file: `/x/${id}.sql`,
  sha256: data === null ? null : sha256(data),
});
const row = (seq: number, id: string, data: string) => ({
  seq,
  id,
  sha256: sha256(data),
  kind: 'schema',
});

function codeOf(fn: () => unknown): number | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof MigrateError) return err.code;
    throw err;
  }
  return undefined;
}

describe('KK-P03a-5 (KK-032-2): defter ↔ journal ↔ dosya doğrulaması', () => {
  const entries = [
    entry(0, '0000_schema_a', 'a'),
    entry(1, '0001_schema_b', 'b'),
    entry(2, '0002_schema_c', 'c'),
  ];

  it('defter journal öneki ve özetler eşitse bekleyenler döner', () => {
    expect(verifyLedger([row(0, '0000_schema_a', 'a')], entries).map((e) => e.id)).toEqual([
      '0001_schema_b',
      '0002_schema_c',
    ]);
  });

  it('özet uyuşmazlığı ve kayıp dosya çıkış 20; sıra bozukluğu çıkış 21', () => {
    expect(codeOf(() => verifyLedger([row(0, '0000_schema_a', 'a2')], entries))).toBe(
      EXIT.checksum,
    );
    expect(
      codeOf(() => verifyLedger([row(0, '0000_schema_a', 'a')], [entry(0, '0000_schema_a', null)])),
    ).toBe(EXIT.checksum);
    expect(codeOf(() => verifyLedger([row(0, '0000_schema_x', 'x')], entries))).toBe(EXIT.checksum);
    expect(codeOf(() => verifyLedger([row(0, '0001_schema_b', 'b')], entries))).toBe(EXIT.order);
    expect(codeOf(() => verifyLedger([row(1, '0001_schema_b', 'b')], entries))).toBe(EXIT.order);
  });

  it('journal okuyucusu boşluklu veya ters sırayı çıkış 21 ile reddeder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eda-journal-'));
    try {
      mkdirSync(join(dir, 'meta'));
      const write = (tags: string[]) =>
        writeFileSync(
          join(dir, 'meta', '_journal.json'),
          JSON.stringify({
            version: '7',
            dialect: 'postgresql',
            entries: tags.map((tag, idx) => ({
              idx,
              tag,
              when: 1,
              breakpoints: true,
              version: '7',
            })),
          }),
        );
      write(['0000_schema_a', '0002_schema_c']);
      await expect(drizzleJournalSource(dir).list()).rejects.toMatchObject({ code: EXIT.order });
      write(['0000_schema_a']);
      writeFileSync(join(dir, '0000_schema_a.sql'), 'a');
      const list = await drizzleJournalSource(dir).list();
      expect(list[0]?.sha256?.equals(sha256('a'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('KK-P03a-11: denetim dosyaları ayraçlardan bölünür, psql değişkenleri parametreye çevrilir', () => {
  it('Q1–Q12 + E1–E6 (KK-P03b-22); :ad -> $n', async () => {
    const queries = await loadAuditQueries(AUDIT_FILES);
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
    const byId = new Map(queries.map((q) => [q.id, q]));
    expect(byId.get('Q1')?.params).toEqual(['k_tables']);
    expect(byId.get('Q10')?.params).toEqual(['content_columns']);
    expect(byId.get('E5')?.params).toEqual(['definer_write_grants']);
    expect(byId.get('E6')?.params).toEqual(['eda_env']);
    for (const q of queries) expect(q.sql, q.id).not.toMatch(/:'[a-z_]+'/);
  });

  it('aynı değişken iki kez geçerse tek parametre kullanılır', () => {
    const [q] = splitAuditFile("-- Q1: x\nSELECT :'a'::text, :'b'::text, :'a'::text;\n");
    expect(q).toEqual({ id: 'Q1', sql: 'SELECT $1::text, $2::text, $1::text', params: ['a', 'b'] });
  });
});
