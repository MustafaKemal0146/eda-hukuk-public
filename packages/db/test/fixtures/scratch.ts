// Yalıtılmış çalıştırıcı dünyası: gerçek veritabanında geçici bir şema + geçici migrasyon dizini.
// Defter (`schema_migrations`) o şemada tutulur, danışma kilidi anahtarı şemaya özeldir; böylece
// gerçek `public` defteri ve gerçek migrasyonlar etkilenmez. Her test sonunda şema düşer.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import {
  drizzleJournalSource,
  type ExitCode,
  type LogEntry,
  type MigrateLogger,
  type MigrateOptions,
  runMigrate,
} from '../../src/migrate/index.ts';
import { newWorldKey, shortKey } from './ids.ts';

export interface MemoryLogger extends MigrateLogger {
  readonly entries: LogEntry[];
  events(event: string): LogEntry[];
}

export function memoryLogger(): MemoryLogger {
  const entries: LogEntry[] = [];
  return {
    entries,
    write(entry) {
      // Gerçek günlükçüyle aynı serileştirme: yalnız JSON'a dönüşen alanlar.
      entries.push(JSON.parse(JSON.stringify(entry)) as LogEntry);
    },
    events(event) {
      return entries.filter((e) => e.event === event);
    },
  };
}

export interface ScratchMigration {
  /** `<tür>_<konu>`; sıra öneki otomatik verilir. */
  readonly name: string;
  /** `{s}` yer tutucusu geçici şema adıyla değiştirilir. */
  readonly sql: string;
}

export interface Scratch {
  readonly schema: string;
  readonly dir: string;
  readonly lockKey: string;
  write(migrations: readonly ScratchMigration[]): string[];
  file(id: string): string;
  run(client: pg.Client, log: MigrateLogger, extra?: Partial<MigrateOptions>): Promise<ExitCode>;
  drop(owner: pg.Client): Promise<void>;
}

export const FAST_SETTINGS = { lockRetryWaitMs: 50, advisoryWaitSec: 30 } as const;

export async function createScratch(owner: pg.Client, prefix = 't'): Promise<Scratch> {
  const schema = `${prefix}_${shortKey(newWorldKey())}`;
  await owner.query(`CREATE SCHEMA ${schema}`);
  const dir = mkdtempSync(join(tmpdir(), `eda-mig-${schema}-`));
  mkdirSync(join(dir, 'meta'));
  const lockKey = `eda:migrate:test:${schema}`;
  const scratch: Scratch = {
    schema,
    dir,
    lockKey,
    write(migrations) {
      const entries = migrations.map((m, idx) => ({
        idx,
        version: '7',
        when: 1_791_000_000_000 + idx,
        tag: `${String(idx).padStart(4, '0')}_${m.name}`,
        breakpoints: true,
      }));
      writeFileSync(
        join(dir, 'meta', '_journal.json'),
        JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2),
      );
      migrations.forEach((m, i) => {
        writeFileSync(join(dir, `${entries[i]?.tag}.sql`), m.sql.replaceAll('{s}', schema));
      });
      return entries.map((e) => e.tag);
    },
    file(id) {
      return join(dir, `${id}.sql`);
    },
    run(client, log, extra = {}) {
      return runMigrate({
        client,
        edaEnv: 'test',
        log,
        source: drizzleJournalSource(dir),
        ledgerSchema: schema,
        lockKey,
        preflight: false,
        audit: false,
        maintenance: false,
        pollMs: 50,
        ...extra,
        settings: { ...FAST_SETTINGS, ...extra.settings },
      });
    },
    async drop(o) {
      await o.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      rmSync(dir, { recursive: true, force: true });
    },
  };
  return scratch;
}

/** Geçici şemadaki defter satır sayısı (defter yoksa null). */
export async function ledgerCount(client: pg.Client, schema: string): Promise<number | null> {
  const exists = await client.query<{ t: string | null }>('SELECT to_regclass($1)::text AS t', [
    `${schema}.schema_migrations`,
  ]);
  if (exists.rows[0]?.t === null) return null;
  const res = await client.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${schema}.schema_migrations`,
  );
  return Number(res.rows[0]?.n);
}

export async function relationExists(client: pg.Client, name: string): Promise<boolean> {
  const res = await client.query<{ t: string | null }>('SELECT to_regclass($1)::text AS t', [name]);
  return res.rows[0]?.t !== null;
}
