// Token üretimi (026 §4.2-§4.3): K_conv = HKDF-SHA256(IKM = hmac_pseudonym_key, salt =
// "eda/kvkk/k_conv/v1", info = scopeId, L = 32); token = "[" TIP "_" base32(HMAC(K_conv, tip ‖ 0x00 ‖
// kimlik))[0:n] "]"; RFC 4648 base32, dolgusuz. Kripto yalnız CryptoPort üzerinden.
import { asciiLower } from '../fold.ts';
import type { CryptoPort } from '../ports.ts';
import type { Tip } from '../types.ts';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const K_CONV_SALT = 'eda/kvkk/k_conv/v1';
export const K_CONV_LENGTH = 32;

export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

/** RFC 4648 base32, dolgu yok. */
export function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += B32.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Sohbet/görev anahtarı; scopeId küçük harfli kanonik biçime (ASCII) getirilir (026 §4.3). */
export function deriveConvKey(
  port: CryptoPort,
  hmacPseudonymKey: Uint8Array,
  scopeId: string,
): Uint8Array {
  return port.hkdfSha256(
    hmacPseudonymKey,
    utf8(K_CONV_SALT),
    utf8(asciiLower(scopeId)),
    K_CONV_LENGTH,
  );
}

/** Tam base32 karma; token uzunluğu (4 veya 6) çakışma çözümünde seçilir (026 §4.5). */
export function tokenHash(port: CryptoPort, kConv: Uint8Array, tip: Tip, identity: string): string {
  const t = utf8(tip);
  const id = utf8(identity);
  const data = new Uint8Array(t.length + 1 + id.length);
  data.set(t, 0);
  data.set(id, t.length + 1);
  return base32(port.hmacSha256(kConv, data));
}

export function formatToken(tip: Tip, hash: string, n: 4 | 6): string {
  return `[${tip}_${hash.slice(0, n)}]`;
}
