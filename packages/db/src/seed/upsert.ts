// Seed upsert politikası (032 §10.1 tablosu). Satır satır `INSERT … ON CONFLICT`; güncelleme yalnız
// değer gerçekten farklıysa (`IS DISTINCT FROM`) yapılır: içerik değişmediyse tablo bayt düzeyinde aynı
// kalır ve `updated_at` tetikleyicisi çalışmaz (KK-032-11 `--force`). Silme yoktur. Korunan kolonlar
// (`is_active`, `verified_*`, `iyzico_plan_ref_*`, yönetici alanları) güncelleme listesine girmez.
// Doğrulanmış (`verified_at` dolu) süre kuralı satırının taslağı değişmişse çıkış 41 (KK-032-12).
import type { ClientBase } from 'pg';
import { EXIT, MigrateError } from '../migrate/exit-codes.ts';

export interface SeedCounts {
  inserted: number;
  updated: number;
  skipped: number;
}

export const emptyCounts = (): SeedCounts => ({ inserted: 0, updated: 0, skipped: 0 });

export interface UpsertSpec {
  /** Tam nitelikli tablo (`app.case_types`). */
  readonly table: string;
  /** Çakışma anahtarı kolonları. */
  readonly key: readonly string[];
  /** Eklenen kolonlar (anahtar dahil), satır nesnesindeki adlarla aynı. */
  readonly columns: readonly string[];
  /** Çakışmada güncellenecek kolonlar; boşsa `DO NOTHING`. */
  readonly update: readonly string[];
  /** Kolon başına SQL tip dönüşümü (`daterange`, `jsonb`, `text[]`, `date`, `time` …). */
  readonly casts?: Readonly<Record<string, string>>;
  /** Güncelleme koşuluna eklenen ek yüklem (ör. `verified_at IS NULL`); hedef tablo adıyla. */
  readonly updateWhere?: string;
}

const IDENT = /^[a-z_][a-z0-9_]*$/;
const QUALIFIED = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;

function assertSpec(spec: UpsertSpec): void {
  if (!QUALIFIED.test(spec.table)) throw new Error(`seed: geçersiz tablo adı: ${spec.table}`);
  for (const c of [...spec.key, ...spec.columns, ...spec.update]) {
    if (!IDENT.test(c)) throw new Error(`seed: geçersiz kolon adı: ${c}`);
  }
}

const placeholder = (spec: UpsertSpec, col: string, i: number): string => {
  const cast = spec.casts?.[col];
  return cast ? `$${i}::${cast}` : `$${i}`;
};

function insertSql(spec: UpsertSpec): string {
  assertSpec(spec);
  const short = spec.table.split('.')[1] ?? spec.table;
  const values = spec.columns.map((c, i) => placeholder(spec, c, i + 1)).join(', ');
  const head = `INSERT INTO ${spec.table} AS ${short} (${spec.columns.join(', ')}) VALUES (${values})
    ON CONFLICT (${spec.key.join(', ')})`;
  if (spec.update.length === 0) return `${head} DO NOTHING RETURNING true AS inserted`;
  const set = spec.update.map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  const target = spec.update.map((c) => `${short}.${c}`).join(', ');
  const excluded = spec.update.map((c) => `EXCLUDED.${c}`).join(', ');
  const extra = spec.updateWhere ? ` AND ${spec.updateWhere}` : '';
  return `${head} DO UPDATE SET ${set}
    WHERE (${target}) IS DISTINCT FROM (${excluded})${extra}
    RETURNING (xmax = 0) AS inserted`;
}

const valuesOf = (spec: UpsertSpec, row: Readonly<Record<string, unknown>>): unknown[] =>
  spec.columns.map((c) => {
    if (!(c in row)) throw new Error(`seed: ${spec.table} satırında kolon eksik: ${c}`);
    return row[c];
  });

/** Satırları politika tablosuna göre yazar; eklenen/güncellenen/değişmeyen sayıları döner. */
export async function upsertRows(
  q: ClientBase,
  spec: UpsertSpec,
  rows: readonly Readonly<Record<string, unknown>>[],
): Promise<SeedCounts> {
  const sql = insertSql(spec);
  const counts = emptyCounts();
  for (const row of rows) {
    const r = await q.query<{ inserted: boolean }>(sql, valuesOf(spec, row));
    const hit = r.rows[0];
    if (hit === undefined) counts.skipped += 1;
    else if (hit.inserted) counts.inserted += 1;
    else counts.updated += 1;
  }
  return counts;
}

/**
 * Doğrulanmış satır koruması (032 §10.1 `deadline_rules`): anahtarı eşleşen, `verified_at` dolu ve
 * güncellenebilir kolonları seed verisinden farklı satır varsa çıkış 41. Hiçbir satır değişmeden
 * çağrılır (işlem geri alınır).
 */
export async function assertVerifiedUnchanged(
  q: ClientBase,
  spec: UpsertSpec,
  rows: readonly Readonly<Record<string, unknown>>[],
): Promise<void> {
  assertSpec(spec);
  const keyPred = spec.key
    .map((k) => `${k} = ${placeholder(spec, k, spec.columns.indexOf(k) + 1)}`)
    .join(' AND ');
  const cols = spec.update.join(', ');
  const vals = spec.update.map((c) => placeholder(spec, c, spec.columns.indexOf(c) + 1)).join(', ');
  const sql = `SELECT 1 FROM ${spec.table}
    WHERE ${keyPred} AND verified_at IS NOT NULL AND (${cols}) IS DISTINCT FROM (${vals})`;
  const changed: string[] = [];
  for (const row of rows) {
    const r = await q.query(sql, valuesOf(spec, row));
    if ((r.rowCount ?? 0) > 0) changed.push(spec.key.map((k) => String(row[k])).join('/'));
  }
  if (changed.length > 0) {
    throw new MigrateError(
      EXIT.seedVerify,
      `doğrulanmış kural taslağı değişmiş (${changed.length} satır): yeni version satırı açın`,
    );
  }
}

/** Kaynaktan kalkan katalog satırlarını pasifleştirir (silme yok; 032 §10.1). */
export async function deactivateMissing(
  q: ClientBase,
  table: string,
  keyColumn: string,
  keep: readonly string[],
): Promise<number> {
  if (!QUALIFIED.test(table) || !IDENT.test(keyColumn)) throw new Error('seed: geçersiz ad');
  const r = await q.query(
    `UPDATE ${table} SET is_active = false WHERE is_active AND NOT (${keyColumn} = ANY ($1::text[]))`,
    [keep],
  );
  return r.rowCount ?? 0;
}
