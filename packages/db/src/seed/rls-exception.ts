// Seed'in RLS'ye tabi yazma istisnası (032 §11.3): politikaların sahibe (eda_owner) yazma izni vermediği
// iki tablo için, ÇAĞIRANIN AÇTIĞI işlem içinde `NO FORCE ROW LEVEL SECURITY` -> yazım -> `FORCE ROW
// LEVEL SECURITY`. İşlem atomiktir (geri almada FORCE geri gelir); kalıntı denetim Q1 ile yakalanır.
// Liste kapalıdır: başka tablo eklenemez (tip + çalışma zamanı denetimi). Prod profili bu modülü
// yüklemez (yalnız dev aşamaları ve test fixture'ları çağırır).
import type { ClientBase } from 'pg';

export const SEED_RLS_EXCEPTIONS = ['subscriptions', 'credit_ledger'] as const;
export type SeedRlsExceptionTable = (typeof SEED_RLS_EXCEPTIONS)[number];

/** `fn`'i istisna penceresinde çalıştırır. `q` açık bir işlemde olmalıdır (BEGIN çağıranda). */
export async function withSeedRlsException<T>(
  q: ClientBase,
  table: SeedRlsExceptionTable,
  fn: () => Promise<T>,
): Promise<T> {
  if (!(SEED_RLS_EXCEPTIONS as readonly string[]).includes(table)) {
    throw new RangeError(`seed RLS istisnası yalnız ${SEED_RLS_EXCEPTIONS.join(', ')} için`);
  }
  await q.query(`ALTER TABLE app.${table} NO FORCE ROW LEVEL SECURITY`);
  // Hata durumunda işlem zaten iptaldir; çağıranın ROLLBACK'i FORCE'u geri getirir.
  const out = await fn();
  await q.query(`ALTER TABLE app.${table} FORCE ROW LEVEL SECURITY`);
  return out;
}
