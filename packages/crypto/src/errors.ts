// @eda/crypto hata türü. Mesajlar Türkçe ve düzelticidir; anahtar, düz metin veya
// şifreli bayt içermez (033 §4.7: anahtar log/hata/denetim kaydına yazılmaz).

export const CRYPTO_ERROR_CODES = ['invalid_input', 'auth_failed', 'kek_file_invalid'] as const;
export type CryptoErrorCode = (typeof CRYPTO_ERROR_CODES)[number];

export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}
