// Ortak kolon yardımcıları (030 §1.2, §1.9): kolon adı her zaman açık snake_case; kimlik uuidv7,
// zaman timestamptz. `app` tablo dosyaları bu modülü kullanır (auth.ts kendi kopyasını taşır).
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  type ForeignKeyBuilder,
  foreignKey,
  type PgColumn,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { sqlValueList } from './_checks.ts';

export const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const idV7 = () => uuid('id').primaryKey().default(sql`uuidv7()`);
/** Bölümlü tablolarda kimlik (PK `(id, created_at)` tablo düzeyinde). */
export const idV7NoPk = () => uuid('id').notNull().default(sql`uuidv7()`);
export const createdAt = () => tstz('created_at').notNull().defaultNow();
export const updatedAt = () => tstz('updated_at').notNull().defaultNow();

/** SQL kolon başvurusu (`"ad"`). */
export const col = (name: string): SQL => sql`${sql.identifier(name)}`;

/** `<tablo>_<kolon>_chk CHECK (<kolon> <@ ARRAY[...]::text[])` (dizi kolonu kapalı küme). */
export function arraySubset(table: string, column: AnyPgColumn, values: readonly string[]) {
  return check(
    `${table}_${column.name}_chk`,
    sql`${sql.identifier(column.name)} <@ ARRAY[${sqlValueList(values)}]::text[]`,
  );
}

/** `<kolon> IN (...)` ifadesi (kısmi indeks ve özel CHECK koşulları için). */
export function inValues(column: string, values: readonly string[]): SQL {
  return sql`${sql.identifier(column)} IN (${sqlValueList(values)})`;
}

/**
 * Adlandırılmış FK (030 §1.4). Bileşik kiracı FK'leri `(org_id, x_id) -> parent(org_id, id)`.
 * `ON DELETE SET NULL (kolon)` Drizzle'da ifade edilemez: TS'de `set null`, migrasyonda kolon
 * listesi `-- eda:patched` ile eklenir.
 */
export function fk(
  name: string,
  columns: [PgColumn, ...PgColumn[]],
  foreignColumns: [PgColumn, ...PgColumn[]],
): ForeignKeyBuilder {
  return foreignKey({ name, columns, foreignColumns });
}
