// Drizzle'da yerleşik olmayan PostgreSQL tipleri (030 §1.9). Değerler sürücüden ham geçer.
import { customType } from 'drizzle-orm/pg-core';

/** SHA-256 özetleri ve şifreli alanlar (030 §1.2). */
export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
});

/** Yerleşik tam metin vektörü (`app.file_chunks`; 030 §1.5 madde 8). */
export const tsvector = customType<{ data: string }>({
  dataType: () => 'tsvector',
});

/** Tarih aralığı (`judicial_recesses.during`). Değer PostgreSQL aralık metnidir: `[2026-07-20,2026-09-01)`. */
export const daterange = customType<{ data: string }>({
  dataType: () => 'daterange',
});

/** Zaman aralığı (`announcements.active_during`). */
export const tstzrange = customType<{ data: string }>({
  dataType: () => 'tstzrange',
});

/**
 * Ham `json` (030 §1.2: yalnız `messages.llm_parts`). Dize olarak yazılır ve okunur; bayt kararlılığı
 * için sürücüde OID 114 ayrıştırıcısı devre dışıdır (030 Tuzak 9).
 */
export const rawJson = customType<{ data: string; driverData: string }>({
  dataType: () => 'json',
});
