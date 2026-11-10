// TCKN/VKN uygulama düzeyi şifreleme ve arama HMAC'i (030 §1.7(b)).
// `*_enc`: nonce (12) ‖ AES-256-GCM(DEK, değer) ‖ etiket (16);
// AAD = org_id (16) ‖ lp(tablo) ‖ satır_id (16) ‖ lp(kolon) ‖ key_version (4, BE); lp = uint16 BE uzunluk öneki.
// `*_hmac`: HMAC-SHA256(K_search_org, normalizeId(değer));
// K_search_org = HKDF-SHA256(hmac_pseudonym_key, salt=∅, info="id-search" ‖ 0x00 ‖ org_id (16), L=32).
import { createHmac, hkdfSync } from 'node:crypto';
import { concatAad, labelBytes, lengthPrefixed, uuidBytes, versionBytes } from './aad.ts';
import { CryptoError } from './errors.ts';
import { assertKey, KEY_BYTES, open, randomNonce, sealWithNonce } from './gcm.ts';

/** `table` şemasız tablo adı (ör. `clients`), `column` kolon adı (ör. `tckn_enc`). */
export type FieldContext = {
  orgId: string;
  table: string;
  rowId: string;
  column: string;
  keyVersion: number;
};

export const ORG_SEARCH_INFO_LABEL = 'id-search';

const IDENT_RE = /^[a-z][a-z0-9_]*$/;
const DIGITS_RE = /^[0-9]+$/;
const EMPTY_SALT = Buffer.alloc(0);
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

/** Alan şifrelemesinin AAD'si. */
export function fieldAad(ctx: FieldContext): Buffer {
  if (!IDENT_RE.test(ctx.table) || !IDENT_RE.test(ctx.column)) {
    throw new CryptoError(
      'invalid_input',
      'Tablo ve kolon adı küçük harfle başlayan snake_case tanımlayıcı olmalı.',
    );
  }
  return concatAad([
    uuidBytes(ctx.orgId),
    lengthPrefixed(ctx.table),
    uuidBytes(ctx.rowId),
    lengthPrefixed(ctx.column),
    versionBytes(ctx.keyVersion),
  ]);
}

/** Değeri (UTF-8) DEK ile şifreler. Normalizasyon çağıranın işidir (`normalizeId`). */
export function encryptField(dek: Uint8Array, ctx: FieldContext, value: string): Buffer {
  return encryptFieldWithNonce(dek, ctx, value, randomNonce());
}

/** Yalnız bilinen-cevap testleri içindir; paket kökünden dışa aktarılmaz. */
export function encryptFieldWithNonce(
  dek: Uint8Array,
  ctx: FieldContext,
  value: string,
  nonce: Uint8Array,
): Buffer {
  assertKey(dek, 'DEK');
  if (value.length === 0) {
    throw new CryptoError('invalid_input', 'Şifrelenecek alan değeri boş olamaz.');
  }
  const aad = fieldAad(ctx);
  const plain = Buffer.from(value, 'utf8');
  try {
    return sealWithNonce(dek, nonce, aad, plain);
  } finally {
    plain.fill(0);
  }
}

/** Şifreli alanı çözer; bağlam, anahtar veya bayt uyuşmazsa `auth_failed`. */
export function decryptField(dek: Uint8Array, ctx: FieldContext, sealed: Uint8Array): string {
  const plain = open(dek, fieldAad(ctx), sealed);
  try {
    return utf8Strict.decode(plain);
  } catch {
    throw new CryptoError('auth_failed', 'Şifreli alan çözüldü ancak geçerli UTF-8 değil.');
  } finally {
    plain.fill(0);
  }
}

/** Büro başına arama anahtarı; bürolar arası HMAC eşleştirmesi yapılamaz. */
export function deriveOrgSearchKey(hmacPseudonymKey: Uint8Array, orgId: string): Buffer {
  assertKey(hmacPseudonymKey, 'hmac_pseudonym_key');
  const info = concatAad([labelBytes(ORG_SEARCH_INFO_LABEL), uuidBytes(orgId)]);
  return Buffer.from(hkdfSync('sha256', hmacPseudonymKey, EMPTY_SALT, info, KEY_BYTES));
}

/** Kimlik numarasından yalnız ASCII rakamları (0-9) bırakır. */
export function normalizeId(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

/** `HMAC-SHA256(orgSearchKey, normalizedId)`; girdi önceden `normalizeId` ile normalize edilmiş olmalı. */
export function searchHmac(orgSearchKey: Uint8Array, normalizedId: string): Buffer {
  assertKey(orgSearchKey, 'Büro arama anahtarı');
  if (!DIGITS_RE.test(normalizedId)) {
    throw new CryptoError(
      'invalid_input',
      'Arama HMAC girdisi normalizeId ile normalize edilmiş, boş olmayan rakam dizisi olmalı.',
    );
  }
  return createHmac('sha256', orgSearchKey).update(normalizedId, 'ascii').digest();
}
