// @eda/kvkk için senkron kripto portu (013 §329, 026 §1.2): HMAC-SHA256 ve HKDF-SHA256, node:crypto ile.
import { createHmac, hkdfSync } from 'node:crypto';

export type KvkkCryptoPort = {
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array;
};

export const nodeKvkkCrypto: KvkkCryptoPort = {
  hmacSha256: (key, data) => new Uint8Array(createHmac('sha256', key).update(data).digest()),
  hkdfSha256: (ikm, salt, info, length) =>
    new Uint8Array(hkdfSync('sha256', ikm, salt, info, length)),
};
