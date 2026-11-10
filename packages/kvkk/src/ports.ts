// Kripto portu (026 §1.2): paket saftır, node:crypto içe aktarmaz (013 kural 7). api/worker portu
// createHmac/hkdfSync ile sağlar (@eda/crypto/kvkk-port); WebCrypto asenkron olduğu için kullanılmaz.

/** Senkron HMAC-SHA256 ve HKDF-SHA256. */
export interface CryptoPort {
  hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array;
  hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array;
}

/** İsteğe bağlı saat portu: yalnız `stats.ms` için; verilmezse süre 0 yazılır (paket saat okumaz). */
export type ClockPort = () => number;
