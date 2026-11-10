// Segmentli AES-256-GCM (EDAE v1; 033 §4.2). Uygulama `../stream.ts` içindedir; bu giriş alt yol
// takma adıdır (`@eda/crypto/aead`).
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
} from '../stream.ts';
