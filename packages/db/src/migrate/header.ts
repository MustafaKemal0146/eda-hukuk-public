// Migrasyon dosyası başlık direktifleri (032 §4.2, §9.2). Yalnız ilk SQL deyiminden önceki
// `-- eda:<ad> [değer]` yorumları okunur; bilinmeyen direktif hatadır (strict).
import { z } from 'zod';

export const MIGRATION_KINDS = [
  'schema',
  'rls',
  'fn',
  'seed',
  'expand',
  'contract',
  'backfill',
  'index',
  'partition',
  'ext',
] as const;
export type MigrationKind = (typeof MIGRATION_KINDS)[number];

/** `--> statement-breakpoint`: drizzle-kit deyim ayracı; işlemsiz dosyalar bundan bölünür. */
export const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

/** Üst sınır: başlık statement-timeout değeri en çok 60 dk (lint M-18). */
export const MAX_STATEMENT_TIMEOUT_MS = 3_600_000;

/** Backfill'de yazılamayan kolonlar: kiracı ve sahiplik bağları (032 §9.2). */
export const BACKFILL_FORBIDDEN_COLUMNS = ['id', 'org_id', 'owner_id', 'user_id'] as const;

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

const BackfillSpec = z
  .object({
    batched: z.boolean(),
    schema: z.string().regex(IDENT),
    table: z.string().regex(IDENT),
    columns: z.array(z.string().regex(IDENT)).min(1),
    insert: z.boolean(),
    batchSize: z.number().int().positive().optional(),
    sleepMs: z.number().int().nonnegative().optional(),
  })
  .strict();
export type BackfillSpec = z.infer<typeof BackfillSpec>;

export const Header = z
  .object({
    kind: z.enum(MIGRATION_KINDS),
    lockTimeoutMs: z.number().int().positive().optional(),
    statementTimeoutMs: z.number().int().positive().max(MAX_STATEMENT_TIMEOUT_MS).optional(),
    noTransaction: z.boolean().default(false),
    patched: z.string().min(1).optional(),
    contractOf: z.string().min(1).optional(),
    destructive: z.string().min(1).optional(),
    backfill: BackfillSpec.optional(),
  })
  .strict();
export type Header = z.infer<typeof Header>;

export class HeaderError extends Error {
  override name = 'HeaderError';
}

const UNIT_MS: Readonly<Record<string, number>> = { ms: 1, s: 1000, min: 60_000, h: 3_600_000 };

/** `2s`, `500ms`, `10min`, `1h` veya yalın milisaniye. */
export function parseDurationMs(value: string): number {
  const m = /^(\d+)\s*(ms|s|min|h)?$/.exec(value.trim());
  if (!m) throw new HeaderError(`geçersiz süre: ${value}`);
  return Number(m[1]) * (UNIT_MS[m[2] ?? 'ms'] ?? 1);
}

/** Başlık yorumlarını döndürür: ilk SQL satırına kadar olan `--` satırları. */
export function headerLines(sql: string): string[] {
  const out: string[] = [];
  for (const raw of sql.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('--') || line.startsWith(STATEMENT_BREAKPOINT)) break;
    out.push(line);
  }
  return out;
}

export interface BackfillDefaults {
  readonly batchSize: number;
  readonly sleepMs: number;
}

/**
 * `app.cases(visibility)` / `app.files(case_id_fold,+insert) batch=5000 sleep=50ms`.
 * `batch=$db.backfillBatchSize` biçimi yapılandırma varsayılanına çözülür.
 */
export function parseBackfill(value: string, batched: boolean, defaults: BackfillDefaults) {
  const m = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\(([^)]*)\)\s*(.*)$/.exec(value.trim());
  if (!m) throw new HeaderError(`geçersiz backfill hedefi: ${value}`);
  const parts = (m[3] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  const insert = parts.includes('+insert');
  const columns = parts.filter((p) => p !== '+insert');
  for (const c of columns) {
    if ((BACKFILL_FORBIDDEN_COLUMNS as readonly string[]).includes(c)) {
      throw new HeaderError(`backfill kiracı/sahiplik kolonuna yazamaz: ${c}`);
    }
  }
  let batchSize: number | undefined;
  let sleepMs: number | undefined;
  for (const opt of (m[4] ?? '').split(/\s+/).filter((s) => s !== '')) {
    const [k, v = ''] = opt.split('=', 2);
    if (k === 'batch') {
      batchSize = v === '$db.backfillBatchSize' ? defaults.batchSize : Number(v);
    } else if (k === 'sleep') {
      sleepMs = v === '$db.backfillBatchSleepMs' ? defaults.sleepMs : parseDurationMs(v);
    } else {
      throw new HeaderError(`bilinmeyen backfill seçeneği: ${k}`);
    }
  }
  if (!batched && (batchSize !== undefined || sleepMs !== undefined)) {
    throw new HeaderError('batch/sleep yalnız eda:backfill-batched ile kullanılır');
  }
  return BackfillSpec.parse({
    batched,
    schema: m[1],
    table: m[2],
    columns,
    insert,
    ...(batched
      ? { batchSize: batchSize ?? defaults.batchSize, sleepMs: sleepMs ?? defaults.sleepMs }
      : {}),
  });
}

/** Dosya başlığını ayrıştırır; biçim hatası `HeaderError` fırlatır. */
export function parseHeader(sql: string, defaults: BackfillDefaults): Header {
  const raw: Record<string, unknown> = {};
  for (const line of headerLines(sql)) {
    const m = /^--\s*eda:([a-z-]+)(?:\s+(.*))?$/.exec(line);
    if (!m) continue;
    const name = m[1] ?? '';
    const value = (m[2] ?? '').trim();
    const once = (key: string, v: unknown): void => {
      if (key in raw) throw new HeaderError(`yinelenen direktif: eda:${name}`);
      raw[key] = v;
    };
    switch (name) {
      case 'kind':
        once('kind', value);
        break;
      case 'lock-timeout':
        once('lockTimeoutMs', parseDurationMs(value));
        break;
      case 'statement-timeout':
        once('statementTimeoutMs', parseDurationMs(value));
        break;
      case 'no-transaction':
        once('noTransaction', true);
        break;
      case 'patched':
        once('patched', value);
        break;
      case 'contract-of':
        once('contractOf', value);
        break;
      case 'destructive':
        once('destructive', value);
        break;
      case 'backfill':
        once('backfill', parseBackfill(value, false, defaults));
        break;
      case 'backfill-batched':
        once('backfill', parseBackfill(value, true, defaults));
        break;
      default:
        throw new HeaderError(`bilinmeyen direktif: eda:${name}`);
    }
  }
  const parsed = Header.safeParse(raw);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => String(i.path[0] ?? 'kind')).join(', ');
    throw new HeaderError(`geçersiz başlık: ${fields}`);
  }
  if (parsed.data.backfill && parsed.data.kind !== 'backfill') {
    throw new HeaderError('eda:backfill yalnız backfill türünde kullanılır');
  }
  if (parsed.data.backfill && parsed.data.noTransaction) {
    throw new HeaderError('backfill dosyası işlemsiz olamaz');
  }
  return parsed.data;
}

/** İşlemsiz dosyayı ayraçtan böler; boş parçalar atılır. */
export function splitStatements(sql: string): string[] {
  return sql
    .split(STATEMENT_BREAKPOINT)
    .map((s) => s.trim())
    .filter((s) => s.replace(/^\s*--.*$/gm, '').trim() !== '');
}
