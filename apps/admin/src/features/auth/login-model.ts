// Yönetim girişi modeli (saf işlevler; arayüzden bağımsız test edilir). Giriş iki yoldan biridir:
// e-posta + parola, ardından TOTP kodu; ya da geçiş anahtarı (passkey). Hata iletileri hesabın
// varlığı hakkında ipucu vermez: yanlış parola, TOTP'siz hesap ve bilinmeyen hesap aynı iletiyi alır.

/** Tarayıcı desteği ilk işlemede BİLİNMEZ (sunucu çıktısıyla aynı); `useEffect` içinde belirlenir. */
export const INITIAL_WEBAUTHN_SUPPORT: boolean | null = null;

export type LoginStep = 'credentials' | 'totp';
export type LoginErrorKey =
  | 'invalidCredentials'
  | 'invalidCode'
  | 'challengeExpired'
  | 'rateLimited'
  | 'passkeyFailed'
  | 'enrollFailed'
  | 'generic';

/** TOTP alanı: yalnız rakam, en çok altı hane. */
export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

export const isTotpCodeComplete = (code: string): boolean => /^\d{6}$/.test(code);

export const isEmailPlausible = (email: string): boolean => {
  const v = email.trim();
  return v.length >= 3 && v.includes('@');
};

/**
 * E-posta yalnız kırpılır: büyük/küçük harf eşlemesini api yapar (`normalizeEmail`, ASCII). Arayüzde
 * `toLocaleLowerCase('tr-TR')` kullanılmaz: "I" -> "ı" olup geçerli adresi bozar.
 */
export const trimLoginEmail = (email: string): string => email.trim();

export interface LoginFailure {
  readonly key: LoginErrorKey;
  /** 429 için `Retry-After` saniyesi. */
  readonly retryAfterSec: number | null;
}

/** Parola adımı yanıtı -> hata anahtarı. */
export function classifyPasswordFailure(status: number, retryAfter: string | null): LoginFailure {
  if (status === 401) return { key: 'invalidCredentials', retryAfterSec: null };
  if (status === 429) return { key: 'rateLimited', retryAfterSec: parseRetryAfter(retryAfter) };
  return { key: 'generic', retryAfterSec: null };
}

/** TOTP adımı yanıtı -> hata anahtarı (bekleme çerezi bitmişse parola adımına dönülür). */
export function classifyTotpFailure(
  status: number,
  code: string | null,
  retryAfter: string | null,
): LoginFailure {
  if (status === 429) return { key: 'rateLimited', retryAfterSec: parseRetryAfter(retryAfter) };
  if (status === 401 && code === 'INVALID_TWO_FACTOR_COOKIE') {
    return { key: 'challengeExpired', retryAfterSec: null };
  }
  if (status === 401 || status === 400) return { key: 'invalidCode', retryAfterSec: null };
  return { key: 'generic', retryAfterSec: null };
}

export function parseRetryAfter(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

/** Parola adımı başarısı: 2FA bekleme yanıtı (`twoFactorRedirect`) gelmişse TOTP adımına geçilir. */
export const needsTotp = (body: unknown): boolean =>
  typeof body === 'object' &&
  body !== null &&
  (body as { twoFactorRedirect?: unknown }).twoFactorRedirect === true;
