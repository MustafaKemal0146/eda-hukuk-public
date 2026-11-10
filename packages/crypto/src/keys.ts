// Anahtar katmanı (033 §4.1, §4.3, §4.4): dosya anahtarı üretimi, varyant türetme,
// DEK (KEK ile) ve dosya anahtarı (DEK ile) sarma. Saf: yalnız node:crypto, I/O yok.
import { hkdfSync, randomBytes } from 'node:crypto';
import { concatAad, labelBytes, uuidBytes, versionBytes } from './aad.ts';
import { CryptoError } from './errors.ts';
import {
  assertKey,
  KEY_BYTES,
  NONCE_BYTES,
  open,
  randomNonce,
  sealWithNonce,
  TAG_BYTES,
} from './gcm.ts';

export const VARIANTS = ['orig', 'searchable', 'clean', 'export'] as const;
export type Variant = (typeof VARIANTS)[number];

/** Sarılı anahtar uzunluğu: nonce (12) ‖ şifreli (32) ‖ etiket (16) = 60 bayt. */
export const WRAPPED_KEY_BYTES = NONCE_BYTES + KEY_BYTES + TAG_BYTES;

export const VARIANT_INFO_PREFIX = 'eda/v1/variant/';
export const FILE_KEY_AAD_LABEL = 'eda/v1/filekey';
export const DEK_AAD_LABEL = 'eda/v1/dek';

/** Nesne bağlamı: `fileId` dışa aktarımlarda `export_id`'dir (033 §4.2). */
export type ObjectContext = { orgId: string; fileId: string; keyVersion: number };
/** DEK sarma bağlamı: `dekVersion` = `org_keys.key_version`, `kekVersion` = DEK'i saran KEK. */
export type DekContext = { orgId: string; dekVersion: number; kekVersion: number };

const EMPTY_SALT = Buffer.alloc(0);

/** Dosya/dışa aktarım başına rastgele 32 bayt anahtar. */
export function generateFileKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** `HKDF-SHA256(file_key, salt=∅, info="eda/v1/variant/" ‖ varyant, L=32)` (033 §4.1). */
export function deriveVariantKey(fileKey: Uint8Array, variant: Variant): Buffer {
  assertKey(fileKey, 'Dosya anahtarı');
  if (!(VARIANTS as readonly string[]).includes(variant)) {
    throw new CryptoError(
      'invalid_input',
      'Bilinmeyen varyant; orig, searchable, clean veya export olmalı.',
    );
  }
  const info = Buffer.from(`${VARIANT_INFO_PREFIX}${variant}`, 'ascii');
  return Buffer.from(hkdfSync('sha256', fileKey, EMPTY_SALT, info, KEY_BYTES));
}

/** `"eda/v1/filekey" ‖ 0x00 ‖ org_id (16) ‖ file_id (16) ‖ key_version (4, BE)` = 51 bayt. */
export function fileKeyAad(ctx: ObjectContext): Buffer {
  return concatAad([
    labelBytes(FILE_KEY_AAD_LABEL),
    uuidBytes(ctx.orgId),
    uuidBytes(ctx.fileId),
    versionBytes(ctx.keyVersion),
  ]);
}

/** `"eda/v1/dek" ‖ 0x00 ‖ org_id (16) ‖ dek_version (4, BE) ‖ kek_version (4, BE)` = 35 bayt. */
export function dekAad(p: DekContext): Buffer {
  return concatAad([
    labelBytes(DEK_AAD_LABEL),
    uuidBytes(p.orgId),
    versionBytes(p.dekVersion),
    versionBytes(p.kekVersion),
  ]);
}

/** Dosya anahtarını DEK ile sarar; 60 bayt. `ctx.keyVersion` nesne başlığındaki sürümdür (033 §4.4). */
export function wrapFileKey(dek: Uint8Array, ctx: ObjectContext, fileKey: Uint8Array): Buffer {
  return wrapFileKeyWithNonce(dek, ctx, fileKey, randomNonce());
}

/** Yalnız bilinen-cevap testleri içindir; paket kökünden dışa aktarılmaz. */
export function wrapFileKeyWithNonce(
  dek: Uint8Array,
  ctx: ObjectContext,
  fileKey: Uint8Array,
  nonce: Uint8Array,
): Buffer {
  assertKey(dek, 'DEK');
  assertKey(fileKey, 'Dosya anahtarı');
  return sealWithNonce(dek, nonce, fileKeyAad(ctx), fileKey);
}

/** DEK ile sarılı dosya anahtarını açar; bağlam veya bayt uyuşmazsa `auth_failed`. */
export function unwrapFileKey(dek: Uint8Array, ctx: ObjectContext, wrapped: Uint8Array): Buffer {
  assertKey(dek, 'DEK');
  return unwrap(dek, fileKeyAad(ctx), wrapped);
}

/** DEK'i KEK ile sarar; 60 bayt (`org_keys.wrapped_dek`). */
export function wrapDek(kek: Uint8Array, p: DekContext, dek: Uint8Array): Buffer {
  return wrapDekWithNonce(kek, p, dek, randomNonce());
}

/** Yalnız bilinen-cevap testleri içindir; paket kökünden dışa aktarılmaz. */
export function wrapDekWithNonce(
  kek: Uint8Array,
  p: DekContext,
  dek: Uint8Array,
  nonce: Uint8Array,
): Buffer {
  assertKey(kek, 'KEK');
  assertKey(dek, 'DEK');
  return sealWithNonce(kek, nonce, dekAad(p), dek);
}

/** KEK ile sarılı DEK'i açar; bağlam veya bayt uyuşmazsa `auth_failed`. */
export function unwrapDek(kek: Uint8Array, p: DekContext, wrapped: Uint8Array): Buffer {
  assertKey(kek, 'KEK');
  return unwrap(kek, dekAad(p), wrapped);
}

function unwrap(key: Uint8Array, aad: Uint8Array, wrapped: Uint8Array): Buffer {
  if (wrapped.length !== WRAPPED_KEY_BYTES) {
    throw new CryptoError('auth_failed', 'Sarılı anahtar 60 bayt olmalı; veri eksik veya bozuk.');
  }
  return open(key, aad, wrapped);
}
