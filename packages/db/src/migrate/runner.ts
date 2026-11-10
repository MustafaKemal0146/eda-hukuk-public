// Migrasyon çalıştırıcısı (032 §4.3, §4.4, §8). Drizzle'ın kendi migrate() işlevi KULLANILMAZ: o tüm
// bekleyenleri tek işlemde koşar, uygulanmış dosyayı doğrulamaz, CONCURRENTLY / kilit yeniden denemesi /
// backfill desteklemez. Kurallar: danışma kilidi; dosya başına tek işlem (defter satırı aynı işlemde);
// SET LOCAL lock_timeout + statement_timeout; 55P03/40P01/40001'de geri alma + bekleme + sınırlı
// yeniden deneme; işlemsiz dosyalar ayraçtan bölünür; durdurma ilkesi; her çalıştırmada checksum.
import type { ClientBase } from 'pg';
import { bindBatch, runWrapped } from './backfill.ts';
import { EXIT, MigrateError } from './exit-codes.ts';
import { type Header, HeaderError, parseHeader, splitStatements } from './header.ts';
import type { MigrationEntry, MigrationSource } from './journal.ts';
import { sha256 } from './journal.ts';
import { ensureLedger, insertLedger, type LedgerRow, readLedger } from './ledger.ts';
import { type MigrateLogger, pgErrorFields } from './log.ts';

/** Kilit/ölümcül kilitlenme/serileştirme hataları: işlem geri alınır ve yeniden denenir. */
export const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set(['55P03', '40P01', '40001']);

export interface RunnerSettings {
  readonly lockTimeoutMs: number;
  readonly statementTimeoutMs: number;
  readonly lockRetries: number;
  readonly lockRetryWaitMs: number;
  readonly advisoryWaitSec: number;
  readonly backfillBatchSize: number;
  readonly backfillBatchSleepMs: number;
  readonly backfillMaxMinutes: number;
}

export interface RunnerContext {
  readonly client: ClientBase;
  readonly source: MigrationSource;
  readonly ledgerSchema: string;
  readonly settings: RunnerSettings;
  readonly log: MigrateLogger;
  readonly sleep: (ms: number) => Promise<void>;
}

// ---------- danışma kilidi ----------

/** `pg_try_advisory_lock(hashtextextended(key, 0))` yoklaması; süre dolarsa çıkış 11. */
export async function acquireAdvisoryLock(
  ctx: Pick<RunnerContext, 'client' | 'log' | 'sleep' | 'settings'>,
  key: string,
  pollMs: number,
): Promise<void> {
  const deadline = Date.now() + ctx.settings.advisoryWaitSec * 1000;
  let waited = false;
  for (;;) {
    const res = await ctx.client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok',
      [key],
    );
    if (res.rows[0]?.ok) {
      ctx.log.write({ level: 'info', event: 'lock.acquired' });
      return;
    }
    if (!waited) ctx.log.write({ level: 'info', event: 'lock.waiting' });
    waited = true;
    if (Date.now() >= deadline) {
      throw new MigrateError(EXIT.advisoryLock, 'danışma kilidi alınamadı (başka migrate sürüyor)');
    }
    await ctx.sleep(pollMs);
  }
}

export async function releaseAdvisoryLock(client: ClientBase, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]);
}

// ---------- defter doğrulama ----------

/**
 * Defter ↔ journal ↔ dosya: uygulanmış her satırın dosyası olmalı ve özeti eşleşmeli (aksi 20);
 * defter journal'ın boşluksuz öneki olmalı (aksi 21). Bekleyen girdileri döndürür.
 */
export function verifyLedger(
  ledger: readonly LedgerRow[],
  entries: readonly MigrationEntry[],
): MigrationEntry[] {
  for (const [i, row] of ledger.entries()) {
    if (row.seq !== i) {
      throw new MigrateError(EXIT.order, `defter sırası bozuk: ${row.id} (beklenen sıra ${i})`);
    }
    const entry = entries[row.seq];
    if (entry === undefined || entry.id !== row.id) {
      if (entries.some((e) => e.id === row.id)) {
        throw new MigrateError(EXIT.order, `journal sırası defterle uyuşmuyor: ${row.id}`);
      }
      throw new MigrateError(EXIT.checksum, `uygulanmış migrasyon journal'da yok: ${row.id}`);
    }
    if (entry.sha256 === null) {
      throw new MigrateError(EXIT.checksum, `uygulanmış migrasyon dosyası kayıp: ${row.id}`);
    }
    if (!entry.sha256.equals(row.sha256)) {
      throw new MigrateError(EXIT.checksum, `uygulanmış migrasyon değişmiş (sha256): ${row.id}`);
    }
  }
  const pending = entries.slice(ledger.length);
  for (const e of pending) {
    if (e.sha256 === null) throw new MigrateError(EXIT.checksum, `migrasyon dosyası yok: ${e.id}`);
  }
  return pending;
}

// ---------- uygulama ----------

const isRetryable = (err: unknown): boolean => {
  const { sqlstate } = pgErrorFields(err);
  return sqlstate !== undefined && RETRYABLE_SQLSTATES.has(sqlstate);
};

function timeouts(ctx: RunnerContext, header: Header): { lock: number; statement: number } {
  return {
    lock: header.lockTimeoutMs ?? ctx.settings.lockTimeoutMs,
    statement: header.statementTimeoutMs ?? ctx.settings.statementTimeoutMs,
  };
}

async function rollbackQuietly(client: ClientBase): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Bağlantı kopmuşsa geri alma zaten sunucuda gerçekleşir.
  }
}

/**
 * `fn`'i yeniden deneme politikasıyla koşar. Yeniden denenebilir hata tükenirse 31, diğer hata 30.
 * `fn` kendi işlemini açar/kapatır; hata durumunda çağrılan `onError` geri almayı yapar.
 */
async function withRetries<T>(
  ctx: RunnerContext,
  entry: MigrationEntry,
  fn: (attempt: number) => Promise<T>,
  onError: () => Promise<void>,
): Promise<{ value: T; attempts: number }> {
  const maxAttempts = ctx.settings.lockRetries + 1;
  for (let attempt = 1; ; attempt++) {
    try {
      return { value: await fn(attempt), attempts: attempt };
    } catch (err) {
      await onError();
      const fields = pgErrorFields(err);
      if (isRetryable(err) && attempt < maxAttempts) {
        ctx.log.write({
          level: 'warn',
          event: 'migration.retry',
          id: entry.id,
          attempt,
          ...fields,
        });
        await ctx.sleep(ctx.settings.lockRetryWaitMs);
        continue;
      }
      const code = isRetryable(err) ? EXIT.lockRetriesExhausted : EXIT.sqlError;
      ctx.log.write({
        level: 'error',
        event: 'migration.failed',
        id: entry.id,
        attempt,
        code,
        ...fields,
      });
      if (err instanceof MigrateError) throw err;
      throw new MigrateError(
        code,
        code === EXIT.lockRetriesExhausted
          ? `kilit yeniden denemeleri tükendi: ${entry.id}`
          : `migrasyon başarısız, işlem geri alındı: ${entry.id}`,
      );
    }
  }
}

async function applyTransactional(
  ctx: RunnerContext,
  entry: MigrationEntry,
  sql: string,
  digest: Buffer,
  header: Header,
): Promise<number> {
  const { client } = ctx;
  const t = timeouts(ctx, header);
  const started = Date.now();
  const { attempts } = await withRetries(
    ctx,
    entry,
    async (attempt) => {
      await client.query('BEGIN');
      await client.query(`SET LOCAL lock_timeout = '${t.lock}ms'`);
      await client.query(`SET LOCAL statement_timeout = '${t.statement}ms'`);
      if (header.backfill) await runWrapped(client, header.backfill, sql);
      else await client.query(sql);
      // Defter satırı aynı işlemde: dosya ya tamamen uygulanır ve kaydedilir ya da hiç.
      await insertLedger(client, ctx.ledgerSchema, {
        seq: entry.seq,
        id: entry.id,
        sha256: digest,
        kind: header.kind,
        txMode: 'transaction',
        durationMs: Date.now() - started,
        attempts: attempt,
      });
      await client.query('COMMIT');
    },
    () => rollbackQuietly(client),
  );
  return attempts;
}

async function applyBatchedBackfill(
  ctx: RunnerContext,
  entry: MigrationEntry,
  sql: string,
  digest: Buffer,
  header: Header,
): Promise<number> {
  const spec = header.backfill;
  if (!spec?.batched) throw new Error('beklenmeyen backfill türü');
  const { client } = ctx;
  const t = timeouts(ctx, header);
  const body = bindBatch(sql, spec.batchSize ?? ctx.settings.backfillBatchSize);
  const started = Date.now();
  const deadline = started + ctx.settings.backfillMaxMinutes * 60_000;
  let attemptsMax = 1;
  for (let iteration = 1; ; iteration++) {
    const itStart = Date.now();
    const { value: rows, attempts } = await withRetries(
      ctx,
      entry,
      async () => {
        await client.query('BEGIN');
        await client.query(`SET LOCAL lock_timeout = '${t.lock}ms'`);
        await client.query(`SET LOCAL statement_timeout = '${t.statement}ms'`);
        const n = await runWrapped(client, spec, body);
        await client.query('COMMIT');
        return n;
      },
      () => rollbackQuietly(client),
    );
    attemptsMax = Math.max(attemptsMax, attempts);
    ctx.log.write({
      level: 'info',
      event: 'backfill.batch',
      id: entry.id,
      iteration,
      rows,
      ms: Date.now() - itStart,
    });
    if (rows === 0) break;
    if (Date.now() > deadline) {
      ctx.log.write({
        level: 'error',
        event: 'migration.failed',
        id: entry.id,
        code: EXIT.sqlError,
        reason: 'backfill süre tavanı',
      });
      throw new MigrateError(EXIT.sqlError, `backfill süre tavanını aştı: ${entry.id}`);
    }
    await ctx.sleep(spec.sleepMs ?? ctx.settings.backfillBatchSleepMs);
  }
  await client.query('BEGIN');
  await insertLedger(client, ctx.ledgerSchema, {
    seq: entry.seq,
    id: entry.id,
    sha256: digest,
    kind: header.kind,
    txMode: 'transaction',
    durationMs: Date.now() - started,
    attempts: attemptsMax,
  });
  await client.query('COMMIT');
  return attemptsMax;
}

async function applyNoTransaction(
  ctx: RunnerContext,
  entry: MigrationEntry,
  sql: string,
  digest: Buffer,
  header: Header,
): Promise<number> {
  const { client } = ctx;
  const t = timeouts(ctx, header);
  const started = Date.now();
  let attemptsMax = 1;
  await client.query(`SET lock_timeout = '${t.lock}ms'`);
  await client.query(`SET statement_timeout = '${t.statement}ms'`);
  try {
    // Her parça ayrı otomatik işlemdir; dosya yinelenebilir olduğundan yarıda kalırsa baştan koşar.
    for (const chunk of splitStatements(sql)) {
      const { attempts } = await withRetries(
        ctx,
        entry,
        async () => {
          await client.query(chunk);
          return undefined;
        },
        async () => undefined,
      );
      attemptsMax = Math.max(attemptsMax, attempts);
    }
    await insertLedger(client, ctx.ledgerSchema, {
      seq: entry.seq,
      id: entry.id,
      sha256: digest,
      kind: header.kind,
      txMode: 'none',
      durationMs: Date.now() - started,
      attempts: attemptsMax,
    });
  } finally {
    await client.query('RESET lock_timeout');
    await client.query('RESET statement_timeout');
  }
  return attemptsMax;
}

/** Tek migrasyonu uygular. */
async function applyOne(ctx: RunnerContext, entry: MigrationEntry): Promise<void> {
  const sql = await ctx.source.read(entry);
  const digest = sha256(Buffer.from(sql, 'utf8'));
  if (entry.sha256 !== null && !digest.equals(entry.sha256)) {
    throw new MigrateError(EXIT.checksum, `migrasyon dosyası okuma sırasında değişti: ${entry.id}`);
  }
  let header: Header;
  try {
    header = parseHeader(sql, {
      batchSize: ctx.settings.backfillBatchSize,
      sleepMs: ctx.settings.backfillBatchSleepMs,
    });
  } catch (err) {
    const reason = err instanceof HeaderError ? err.message : 'başlık okunamadı';
    ctx.log.write({
      level: 'error',
      event: 'migration.failed',
      id: entry.id,
      code: EXIT.sqlError,
      reason,
    });
    throw new MigrateError(EXIT.sqlError, `migrasyon başlığı geçersiz: ${entry.id}`);
  }
  const kindFromName = /^[0-9]{4}_([a-z]+)_/.exec(entry.id)?.[1];
  if (kindFromName !== header.kind) {
    ctx.log.write({
      level: 'error',
      event: 'migration.failed',
      id: entry.id,
      code: EXIT.sqlError,
      reason: 'eda:kind dosya adıyla uyuşmuyor',
    });
    throw new MigrateError(EXIT.sqlError, `eda:kind dosya adıyla uyuşmuyor: ${entry.id}`);
  }
  const txMode = header.noTransaction ? 'none' : 'transaction';
  ctx.log.write({
    level: 'info',
    event: 'migration.start',
    id: entry.id,
    kind: header.kind,
    tx_mode: txMode,
  });
  const started = Date.now();
  let attempts: number;
  if (header.noTransaction) attempts = await applyNoTransaction(ctx, entry, sql, digest, header);
  else if (header.backfill?.batched)
    attempts = await applyBatchedBackfill(ctx, entry, sql, digest, header);
  else attempts = await applyTransactional(ctx, entry, sql, digest, header);
  ctx.log.write({
    level: 'info',
    event: 'migration.applied',
    id: entry.id,
    kind: header.kind,
    tx_mode: txMode,
    attempt: attempts,
    ms: Date.now() - started,
  });
}

/** Defteri kurar, doğrular ve bekleyenleri sırayla uygular (durdurma ilkesi). */
export async function applyPending(ctx: RunnerContext): Promise<{ applied: number }> {
  await ensureLedger(ctx.client, ctx.ledgerSchema);
  const entries = await ctx.source.list();
  const ledger = await readLedger(ctx.client, ctx.ledgerSchema);
  const pending = verifyLedger(ledger, entries);
  ctx.log.write({ level: 'info', event: 'migrations.pending', pending: pending.length });
  for (const entry of pending) await applyOne(ctx, entry);
  return { applied: pending.length };
}
