// Çerez adları ve öznitelikleri (042 §2.4; KK-042-1). Better Auth güvenli çerezlerde kendi `__Secure-`
// önekini eklediğinden (`useSecureCookies`) bu bayrak kapalı tutulur, `Secure` özniteliği açıkça
// verilir ve tüm adlar `advanced.cookies` ile yazılır; sonuç `__Host-eda.<ad>`; `Domain` yok.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE_PREFIX = '__Host-eda';
export const SESSION_COOKIE = `${COOKIE_PREFIX}.session_token`;
export const DONT_REMEMBER_COOKIE = `${COOKIE_PREFIX}.dont_remember`;
/** `cookieCache` kapalı; ad yine de öneklidir (yazılırsa yanlış adla yazılmasın). */
export const SESSION_DATA_COOKIE = `${COOKIE_PREFIX}.session_data`;

export const COOKIE_ATTRIBUTES = {
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
} as const;

/** İstek başlığında oturum çerezi var mı (401 nedeni ayrımı: yok -> UNAUTHENTICATED, var -> EXPIRED). */
export function hasSessionCookie(cookieHeader: string | null | undefined): boolean {
  if (cookieHeader === null || cookieHeader === undefined) return false;
  return cookieHeader.split(';').some((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

/** 2FA bekleme çerezi (`twoFactor` eklentisi; ömür `auth.twoFactorPendingMin`; 042 §2.4). */
export const TWO_FACTOR_COOKIE = `${COOKIE_PREFIX}.two_factor`;
/** Passkey meydan okuma çerezi (`webAuthnChallengeCookie` adı; ömür 5 dk; 042 §2.4). */
export const PASSKEY_CHALLENGE_COOKIE_NAME = 'passkey_challenge';
export const PASSKEY_CHALLENGE_COOKIE = `${COOKIE_PREFIX}.${PASSKEY_CHALLENGE_COOKIE_NAME}`;

/** Çerez başlığından ad -> değer (URL kodlaması çözülür; bozuk değer atlanır). */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (cookieHeader === null || cookieHeader === undefined) return null;
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Better Auth imzalı çerez değeri (`<değer>.<base64(HMAC-SHA256(secret, değer))>`; better-call 1.4).
 * İmza tutmazsa `null`. Sabit zamanlı karşılaştırma.
 */
export function verifySignedCookieValue(raw: string | null, secret: string): string | null {
  if (raw === null) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const value = raw.slice(0, dot);
  const sig = Buffer.from(raw.slice(dot + 1), 'base64');
  const expected = createHmac('sha256', secret).update(value, 'utf8').digest();
  return sig.length === expected.length && timingSafeEqual(sig, expected) ? value : null;
}
