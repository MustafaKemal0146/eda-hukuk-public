// migrate akışı (032 §6): ön koşul -> [S3 bootstrap] -> danışma kilidi -> defter -> checksum ->
// bekleyenler -> app.ensure_partitions() -> eklenti sürümü -> seed (runSeed) -> audit.sql + audit-extra.sql ->
// kilidi bırak. Çıkış kodları exit-codes.ts (032 §6.6). Bağlantı tek ve eda_owner'dır.
import { fileURLToPath } from 'node:url';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { ClientBase } from 'pg';
import { CONTENT_COLUMNS, definerWriteGrants, K_TABLES } from '../rls/manifest.ts';
import { type BootstrapClient, runS3Bootstrap, type S3BootstrapConfig } from '../s3/bootstrap.ts';
import { type DevSampleSecrets, defaultSeeds, runSeed } from '../seed/index.ts';
import { parseEdaEnv, type SeedProfile } from '../seed/profile.ts';
import { type AuditParams, type AuditQuery, auditOrFail, loadAuditQueries } from './audit.ts';
import { EXIT, type ExitCode, MigrateError } from './exit-codes.ts';
import { drizzleJournalSource, type MigrationSource } from './journal.ts';
import { type MigrateLogger, pgErrorFields } from './log.ts';
import { type PreflightFacts, runPreflight } from './preflight.ts';
import {
  acquireAdvisoryLock,
  applyPending,
  type RunnerSettings,
  releaseAdvisoryLock,
} from './runner.ts';

export { EXIT, type ExitCode, MigrateError } from './exit-codes.ts';
export { drizzleJournalSource, type MigrationEntry, type MigrationSource } from './journal.ts';
export { type LogEntry, type MigrateLogger, stdoutLogger } from './log.ts';

/** Paket kökü: kaynakta packages/db, imajda /app (dist/bin/migrate.js -> ../../). */
const PACKAGE_ROOT = new URL('../../', import.meta.url);
export const MIGRATIONS_DIR = fileURLToPath(new URL('migrations/', PACKAGE_ROOT));
export const AUDIT_FILES = [
  fileURLToPath(new URL('audit/audit.sql', PACKAGE_ROOT)),
  fileURLToPath(new URL('audit/audit-extra.sql', PACKAGE_ROOT)),
] as const;
export const ADVISORY_LOCK_KEY = 'eda:migrate';

/** Varsayılan ayarlar: @eda/contracts db.* anahtarları (032 §8.1). */
export const DEFAULT_SETTINGS: RunnerSettings = {
  lockTimeoutMs: CONFIG_DEFAULTS['db.lockTimeoutMs'],
  statementTimeoutMs: CONFIG_DEFAULTS['db.migrationStatementTimeoutMs'],
  lockRetries: CONFIG_DEFAULTS['db.migrationLockRetries'],
  lockRetryWaitMs: CONFIG_DEFAULTS['db.migrationLockRetryWaitMs'],
  advisoryWaitSec: CONFIG_DEFAULTS['db.migrationAdvisoryWaitSec'],
  backfillBatchSize: CONFIG_DEFAULTS['db.backfillBatchSize'],
  backfillBatchSleepMs: CONFIG_DEFAULTS['db.backfillBatchSleepMs'],
  backfillMaxMinutes: CONFIG_DEFAULTS['db.backfillMaxMinutes'],
};

/**
 * Denetim parametreleri RLS manifestinden üretilir (031 §13, §14; 032 §6.5): `k_tables` (K ve "—"
 * app tabloları), `content_columns` (Q10 içerik kolonu yasak listesi), `definer_write_grants` (E5).
 */
export function defaultAuditParams(edaEnv: string): AuditParams {
  return {
    k_tables: K_TABLES,
    content_columns: CONTENT_COLUMNS,
    eda_env: edaEnv,
    definer_write_grants: definerWriteGrants(),
  };
}

export interface MigrateOptions {
  readonly client: ClientBase;
  readonly edaEnv: string;
  readonly log: MigrateLogger;
  readonly source?: MigrationSource;
  readonly ledgerSchema?: string;
  readonly lockKey?: string;
  readonly settings?: Partial<RunnerSettings>;
  /** Kilit ve uzun işlem yoklama aralığı. */
  readonly pollMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Ön koşul olgularını toplayan işlev (test simülasyonu); `false` ön koşulu atlar. */
  readonly preflight?: false | ((client: ClientBase) => Promise<PreflightFacts>);
  /** Denetim sorguları; `false` denetimi atlar (yalıtılmış çalıştırıcı testleri). */
  readonly audit?:
    | false
    | { readonly queries?: readonly AuditQuery[]; readonly params?: AuditParams };
  /** app.ensure_partitions ve eklenti adımları; yalıtılmış testlerde kapatılır. */
  readonly maintenance?: boolean;
  /** Seed adımı (032 §10.1): profil verilirse `runSeed` koşar; verilmezse atlanır. */
  readonly seed?: { readonly profile: SeedProfile; readonly devSecrets?: DevSampleSecrets };
  /** S3 bootstrap (kova + yaşam döngüsü); verilmezse atlanır. */
  readonly s3?: MigrateS3;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** S3 bootstrap yapılandırması: istemci + kova/ilke parametreleri (`bin/migrate.ts` env'den kurar). */
export interface MigrateS3 {
  readonly client: BootstrapClient;
  readonly config: S3BootstrapConfig;
}

/**
 * S3 bootstrap (033 §3.3–§3.4): kovalar, yaşam döngüsü, Object Lock. Yapılandırma verilmezse atlanır
 * (günlükte `s3.bootstrap.skipped`). Üretimde hata çıkış 51'dir; geliştirme/testte (objstore ayakta
 * olmayabilir) uyarı yazılıp devam edilir ve her uyarı günlüğe düşer: sessiz atlama yoktur.
 */
export async function s3Bootstrap(
  log: MigrateLogger,
  s3?: MigrateS3,
  edaEnv?: string,
  sleep?: (ms: number) => Promise<void>,
): Promise<void> {
  if (s3 === undefined) {
    log.write({ level: 'info', event: 's3.bootstrap.skipped', reason: 'no_config' });
    return;
  }
  const devLike = edaEnv === 'development' || edaEnv === 'test';
  try {
    const report = await runS3Bootstrap(s3.client, s3.config, {
      attempts: devLike ? 1 : 6,
      delayMs: 2000,
      ...(sleep === undefined ? {} : { sleep }),
      log: (event, fields) =>
        log.write({
          level: 'warn',
          event,
          ...(typeof fields.bucket === 'string' ? { id: fields.bucket } : {}),
          ...(typeof fields.feature === 'string' ? { kind: fields.feature } : {}),
          ...(typeof fields.attempt === 'number' ? { attempt: fields.attempt } : {}),
        }),
    });
    log.write({
      level: 'info',
      event: 's3.bootstrap.done',
      count: report.created.length,
      skipped: report.unsupported.length,
    });
  } catch {
    log.write({
      level: devLike ? 'warn' : 'error',
      event: 's3.bootstrap.failed',
      reason: 'unavailable',
    });
    if (!devLike)
      throw new MigrateError(EXIT.s3Bootstrap, 'S3 bootstrap başarısız (objstore, 073)');
  }
}

/**
 * `app.ensure_partitions()` her koşuda çağrılır (032 §6.4, KK-032-19): içinde bulunulan ay + 3 ay
 * bölümleri garanti edilir. İşlev yoksa (0015 uygulanmamış) hata: çıkış 30 (SQL hatası).
 */
export async function ensurePartitions(client: ClientBase, log: MigrateLogger): Promise<void> {
  const res = await client.query<{ created: number }>('SELECT app.ensure_partitions() AS created');
  log.write({ level: 'info', event: 'partitions.ensured', count: res.rows[0]?.created ?? 0 });
}

/**
 * Eklenti sürüm denetimi (032 §6.3): kurulu sürüm imajdaki varsayılandan geriyse `ALTER EXTENSION
 * ... UPDATE` denenir; yetki hatasında (süper kullanıcı gerektiren eklenti) çıkış 10 ve runbook (073).
 */
export async function checkExtensionVersions(
  client: ClientBase,
  log: MigrateLogger,
): Promise<void> {
  const res = await client.query<{ extname: string }>(
    `SELECT e.extname FROM pg_catalog.pg_extension e
     JOIN pg_catalog.pg_available_extensions a ON a.name = e.extname
     WHERE e.extversion IS DISTINCT FROM a.default_version`,
  );
  for (const { extname } of res.rows) {
    if (!/^[a-z0-9_]+$/.test(extname)) continue;
    try {
      await client.query(`ALTER EXTENSION "${extname}" UPDATE`);
      log.write({ level: 'info', event: 'extension.updated', id: extname });
    } catch (err) {
      log.write({
        level: 'error',
        event: 'extension.update_failed',
        id: extname,
        ...pgErrorFields(err),
      });
      throw new MigrateError(
        EXIT.preflight,
        `eklenti güncellenemedi: ${extname} (infra/postgres/upgrade, 073)`,
      );
    }
  }
}

/** Tam migrate akışı; çıkış kodunu döndürür (fırlatmaz). */
export async function runMigrate(opts: MigrateOptions): Promise<ExitCode> {
  const settings: RunnerSettings = { ...DEFAULT_SETTINGS, ...opts.settings };
  const sleep = opts.sleep ?? defaultSleep;
  const pollMs = opts.pollMs ?? 500;
  const lockKey = opts.lockKey ?? ADVISORY_LOCK_KEY;
  const { client, log } = opts;
  const started = Date.now();
  let locked = false;
  // Hata günlüğünde adım adı (SQL/ileti yerine) taşınır.
  let stage = 'session';
  try {
    await client.query("SET TIME ZONE 'UTC'");
    stage = 'preflight';
    if (opts.preflight !== false) {
      await runPreflight(client, {
        log,
        longTxSec: CONFIG_DEFAULTS['db.migrationLongTxSec'],
        waitBudgetMs: settings.advisoryWaitSec * 1000,
        pollMs,
        sleep,
        ...(opts.preflight ? { gather: opts.preflight } : {}),
      });
    }
    stage = 's3';
    await s3Bootstrap(log, opts.s3, opts.edaEnv, sleep);
    stage = 'lock';
    await acquireAdvisoryLock({ client, log, sleep, settings }, lockKey, pollMs);
    locked = true;
    stage = 'migrations';
    const { applied } = await applyPending({
      client,
      source: opts.source ?? drizzleJournalSource(MIGRATIONS_DIR),
      ledgerSchema: opts.ledgerSchema ?? 'public',
      settings,
      log,
      sleep,
    });
    stage = 'maintenance';
    if (opts.maintenance !== false) {
      await ensurePartitions(client, log);
      await checkExtensionVersions(client, log);
    }
    stage = 'seed';
    if (opts.seed !== undefined) {
      await runSeed({
        client,
        profile: opts.seed.profile,
        edaEnv: parseEdaEnv(opts.edaEnv),
        log,
        ledgerSchema: opts.ledgerSchema ?? 'public',
        seeds: defaultSeeds(opts.seed.devSecrets),
      });
    } else {
      log.write({ level: 'info', event: 'seed.skipped', reason: 'disabled' });
    }
    stage = 'audit';
    if (opts.audit !== false) {
      const queries = opts.audit?.queries ?? (await loadAuditQueries(AUDIT_FILES));
      await auditOrFail(
        client,
        queries,
        opts.audit?.params ?? defaultAuditParams(opts.edaEnv),
        log,
      );
    }
    log.write({
      level: 'info',
      event: 'migrate.done',
      applied,
      code: EXIT.ok,
      ms: Date.now() - started,
    });
    return EXIT.ok;
  } catch (err) {
    const code: ExitCode = err instanceof MigrateError ? err.code : EXIT.sqlError;
    log.write({
      level: 'error',
      event: 'migrate.failed',
      code,
      ms: Date.now() - started,
      ...(err instanceof MigrateError
        ? { reason: err.message }
        : { reason: stage, ...pgErrorFields(err) }),
    });
    return code;
  } finally {
    if (locked) {
      try {
        await releaseAdvisoryLock(client, lockKey);
      } catch {
        // Bağlantı kapanınca oturum kilidi sunucuda zaten bırakılır.
      }
    }
  }
}
