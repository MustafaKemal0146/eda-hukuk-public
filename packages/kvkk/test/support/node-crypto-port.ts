// Test CryptoPort'u (026 Açık Sorular 1): node:crypto ile; yalnız test dizininde serbesttir. Anahtar
// 026 §4.6 vektörünün sabit sentetik anahtarıdır; üretim anahtarı asla kullanılmaz.
import { createHmac, hkdfSync } from 'node:crypto';
import type { CryptoPort } from '../../src/ports.ts';

export const nodeCryptoPort: CryptoPort = {
  hmacSha256: (key, data) => new Uint8Array(createHmac('sha256', key).update(data).digest()),
  hkdfSha256: (ikm, salt, info, length) =>
    new Uint8Array(hkdfSync('sha256', ikm, salt, info, length)),
};

export const TEST_KEY = Uint8Array.from({ length: 32 }, (_, i) => i);
export const TEST_SCOPE = '01900000-0000-7000-8000-000000000001';
