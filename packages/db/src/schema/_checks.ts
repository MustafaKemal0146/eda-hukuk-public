// Enum = text + CHECK (030 §1.3). CHECK listeleri elle yazılmaz: @eda/contracts enums.ts dizilerinden
// üretilir. Değerler SQL'e sql.raw ile girdiği için biçim doğrulanır; kısıt adı <tablo>_<kolon>_chk.
import { type SQL, sql } from 'drizzle-orm';
import { type AnyPgColumn, check } from 'drizzle-orm/pg-core';

const SAFE_VALUE = /^[a-zA-Z0-9_.-]+$/;

/** `'a', 'b'` biçiminde güvenli SQL değer listesi; biçim dışı değer hata fırlatır. */
export function sqlValueList(values: readonly string[]): SQL {
  if (values.length === 0) throw new Error('inList: boş değer listesi');
  for (const v of values) {
    if (!SAFE_VALUE.test(v)) throw new Error(`inList: güvensiz enum değeri: ${v}`);
  }
  return sql.raw(values.map((v) => `'${v}'`).join(', '));
}

/** `<tablo>_<kolon>_chk CHECK (<kolon> IN (...))` kısıtı. NULL değer CHECK'i geçer (kolonun NOT NULL'u ayrıdır). */
export function inList(table: string, column: AnyPgColumn, values: readonly string[]) {
  return check(
    `${table}_${column.name}_chk`,
    sql`${sql.identifier(column.name)} IN (${sqlValueList(values)})`,
  );
}
