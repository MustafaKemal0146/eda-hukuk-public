// Katalog veri modüllerinin ortak yardımcıları (032 §10.3–§10.5): ISO tarih/saat şemaları, yarı açık
// tarih aralığı ve derin dondurma. Saf modül; G/Ç yok.
import { z } from 'zod';

/** `YYYY-MM-DD` takvim tarihi (DB `date`). */
export const IsoDateString = z.iso.date();

/** `HH:MM` yerel saat (DB `time`, Europe/Istanbul). */
export const LocalTimeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Yarı açık tarih aralığı `[start, endExclusive)` (DB `daterange`). `endExclusive = null` üst sınırsız
 * aralıktır (`[2024-01-01,)`).
 */
export const DateRangeSchema = z
  .strictObject({
    start: IsoDateString,
    endExclusive: IsoDateString.nullable(),
  })
  .refine((r) => r.endExclusive === null || r.start < r.endExclusive, {
    message: 'Aralık başlangıcı bitişten önce olmalıdır.',
  });

export type DateRange = Readonly<z.infer<typeof DateRangeSchema>>;

/** PostgreSQL `daterange` metni: `[2026-07-20,2026-09-01)` veya `[2024-01-01,)`. */
export function toDateRangeLiteral(range: DateRange): string {
  return `[${range.start},${range.endExclusive ?? ''})`;
}

/** Nesne ağacını derin dondurur; katalog sabitleri çalışma anında değiştirilemez. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
