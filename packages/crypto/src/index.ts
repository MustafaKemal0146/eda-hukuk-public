// @eda/crypto kök girişi (033 §4): anahtar katmanı, alan şifreleme, KEK dosyası ayrıştırıcısı.
// Saf paket; yalnız node:crypto. Nonce enjekte eden `*WithNonce` işlevleri yalnız testler içindir
// ve burada dışa aktarılmaz.
export {
  concatAad,
  labelBytes,
  lengthPrefixed,
  UINT16_MAX,
  UINT32_MAX,
  uint32Bytes,
  uuidBytes,
  versionBytes,
} from './aad.ts';
export { CRYPTO_ERROR_CODES, CryptoError, type CryptoErrorCode } from './errors.ts';
export {
  decryptField,
  deriveOrgSearchKey,
  encryptField,
  type FieldContext,
  fieldAad,
  normalizeId,
  ORG_SEARCH_INFO_LABEL,
  searchHmac,
} from './field.ts';
export { KEY_BYTES, NONCE_BYTES, TAG_BYTES } from './gcm.ts';
export {
  deriveJobParamsKey,
  JOB_PARAMS_AAD_LABEL,
  JOB_PARAMS_INFO,
  type JobParamsContext,
  jobParamsAad,
  type SealedParams,
  sealJobParams,
  unsealJobParams,
} from './job-params.ts';
export { type KekMaterial, parseKekFile } from './kek-file.ts';
export {
  DEK_AAD_LABEL,
  type DekContext,
  dekAad,
  deriveVariantKey,
  FILE_KEY_AAD_LABEL,
  fileKeyAad,
  generateFileKey,
  type ObjectContext,
  unwrapDek,
  unwrapFileKey,
  VARIANT_INFO_PREFIX,
  VARIANTS,
  type Variant,
  WRAPPED_KEY_BYTES,
  wrapDek,
  wrapFileKey,
} from './keys.ts';
export {
  type CipherRange,
  cipherRangeFor,
  createSegmentDecryptor,
  createSegmentEncryptor,
  type DecryptOptions,
  decryptIterable,
  encryptIterable,
  HEADER_BYTES,
  layoutOf,
  type ObjectLayout,
  parseHeader,
  SEGMENT_CIPHER_BYTES_MAX,
  SEGMENT_PLAIN_BYTES,
  type SegmentDecryptor,
  type SegmentEncryptor,
} from './stream.ts';
export { wipe } from './wipe.ts';
