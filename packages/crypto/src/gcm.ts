// AES-256-GCM tek parça mühürleme (anahtar sarma ve alan şifreleme ortak çekirdeği).
// Biçim: nonce (12) ‖ şifreli metin ‖ etiket (16). Bu modül paket kökünden dışa aktarılmaz.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CryptoError } from './errors.ts';

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

const ALG = 'aes-256-gcm';

/** Anahtar uzunluğunu doğrular (AES-256 için 32 bayt). */
export function assertKey(key: Uint8Array, what: string): void {
  if (key.length !== KEY_BYTES) {
    throw new CryptoError('invalid_input', `${what} 32 bayt olmalı.`);
  }
}

/** Üretim yolu: her çağrıda CSPRNG ile yeni 12 bayt nonce. */
export function randomNonce(): Buffer {
  return randomBytes(NONCE_BYTES);
}

/** Verilen nonce ile mühürler. Üretim çağıranları nonce'u yalnız `randomNonce()` ile verir. */
export function sealWithNonce(
  key: Uint8Array,
  nonce: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
): Buffer {
  assertKey(key, 'Şifreleme anahtarı');
  if (nonce.length !== NONCE_BYTES) {
    throw new CryptoError('invalid_input', 'Nonce 12 bayt olmalı.');
  }
  const cipher = createCipheriv(ALG, key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const head = cipher.update(plaintext);
  const tail = cipher.final();
  const tag = cipher.getAuthTag();
  return Buffer.concat([nonce, head, tail, tag]);
}

/** Mühürlü veriyi açar; etiket doğrulanmazsa düz metin tamponu sıfırlanır ve hata fırlatılır. */
export function open(key: Uint8Array, aad: Uint8Array, sealed: Uint8Array): Buffer {
  assertKey(key, 'Çözme anahtarı');
  if (sealed.length < NONCE_BYTES + TAG_BYTES) {
    throw new CryptoError('auth_failed', 'Şifreli veri çözülemedi: veri eksik veya bozuk.');
  }
  const buf = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.length);
  const nonce = buf.subarray(0, NONCE_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const body = buf.subarray(NONCE_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv(ALG, key, nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(aad);
  decipher.setAuthTag(tag);
  // Node'da GCM update() doğrulamadan önce düz metin döndürür; final() başarılı olmadan
  // bu tampon çağırana verilmez (033 §4.5).
  const head = decipher.update(body);
  try {
    const tail = decipher.final();
    if (tail.length === 0) return head;
    const out = Buffer.concat([head, tail]);
    head.fill(0);
    tail.fill(0);
    return out;
  } catch {
    head.fill(0);
    throw new CryptoError(
      'auth_failed',
      'Şifreli veri çözülemedi: bağlam (AAD), anahtar veya veri bütünlüğü doğrulanamadı.',
    );
  }
}
