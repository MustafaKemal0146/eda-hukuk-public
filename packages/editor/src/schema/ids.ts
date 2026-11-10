// Blok kimliği (054 §3.1): `b-` + 6 karakter Crockford base32, kriptografik rastgele (30 bit).
// Sunucuda yeni blok yaratan her kod bu işlevi açıkça çağırır (UniqueID sunucuda çalışmaz).
import { BLOCK_ID_PATTERN } from '@eda/contracts/editor-doc';

export { BLOCK_ID_PATTERN };

/** Crockford base32 alfabesi (I, L, O, U yok). */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ID_CHARS = 6;
/** Çakışmada yeniden üretim üst sınırı; aşılırsa küme dolmuş demektir (hata). */
const MAX_ATTEMPTS = 64;

export type RandomBytes = (length: number) => Uint8Array;

/** WebCrypto (tarayıcı ve Node 24 `globalThis.crypto`); `node:crypto` kullanılmaz (pure-no-io). */
const webRandom: RandomBytes = (length) =>
  globalThis.crypto.getRandomValues(new Uint8Array(length));

export function isBlockId(value: unknown): value is string {
  return typeof value === 'string' && BLOCK_ID_PATTERN.test(value);
}

/**
 * Yeni blok kimliği üretir; `existing` içinde varsa yeniden üretir (KK-054-3).
 * `randomBytes` yalnız test için enjekte edilir.
 */
export function newBlockId(
  existing: ReadonlySet<string> = new Set(),
  randomBytes: RandomBytes = webRandom,
): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const bytes = randomBytes(ID_CHARS);
    let id = 'b-';
    for (let i = 0; i < ID_CHARS; i++) id += CROCKFORD[(bytes[i] ?? 0) & 31];
    if (!existing.has(id)) return id;
  }
  throw new Error('Benzersiz blok kimliği üretilemedi.');
}
