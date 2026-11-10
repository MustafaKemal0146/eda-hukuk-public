// @tk TK-28
// Yönetim girişi modeli (parola + TOTP, passkey ikincil): hata sınıflandırma, kod
// normalizasyonu, hidrasyon güvenli ilk durum ve tr.json'daki yöntem-nötr metinler.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  classifyPasswordFailure,
  classifyTotpFailure,
  INITIAL_WEBAUTHN_SUPPORT,
  isEmailPlausible,
  isTotpCodeComplete,
  needsTotp,
  normalizeTotpCode,
  parseRetryAfter,
  trimLoginEmail,
} from '../src/features/auth/login-model.ts';

const messages = JSON.parse(
  readFileSync(new URL('../messages/tr.json', import.meta.url), 'utf8'),
) as Record<string, Record<string, unknown>>;

describe('KK-P27a-10: giriş formu modeli', () => {
  it('tarayıcı desteği ilk render te bilinmez (sunucu çıktısıyla aynı; hidrasyon uyuşmazlığı yok)', () => {
    expect(INITIAL_WEBAUTHN_SUPPORT).toBeNull();
  });

  it('TOTP kodu yalnız rakam ve en çok altı hane; tamlık denetimi', () => {
    expect(normalizeTotpCode(' 12a3-45 678')).toBe('123456');
    expect(isTotpCodeComplete('123456')).toBe(true);
    expect(isTotpCodeComplete('12345')).toBe(false);
    expect(isTotpCodeComplete('12345a')).toBe(false);
  });

  it('e-posta yalnız kırpılır (Türkçe I/ı dönüşümü adresi bozmaz); eşleme api tarafındadır', () => {
    expect(trimLoginEmail('  ADMIN@Ornek.TEST ')).toBe('ADMIN@Ornek.TEST');
    expect(isEmailPlausible('a@b')).toBe(true);
    expect(isEmailPlausible('abc')).toBe(false);
  });

  it('parola adımı: 401 tek tip, 429 bekleme süresiyle, diğerleri genel hata', () => {
    expect(classifyPasswordFailure(401, null)).toEqual({
      key: 'invalidCredentials',
      retryAfterSec: null,
    });
    expect(classifyPasswordFailure(429, '17')).toEqual({ key: 'rateLimited', retryAfterSec: 17 });
    expect(classifyPasswordFailure(429, 'x').retryAfterSec).toBeNull();
    expect(classifyPasswordFailure(500, null).key).toBe('generic');
  });

  it('TOTP adımı: yanlış kod, süresi dolan bekleme çerezi ve hız sınırı ayrışır', () => {
    expect(classifyTotpFailure(401, 'INVALID_CODE', null).key).toBe('invalidCode');
    expect(classifyTotpFailure(401, 'INVALID_TWO_FACTOR_COOKIE', null).key).toBe(
      'challengeExpired',
    );
    expect(classifyTotpFailure(429, null, '30')).toEqual({
      key: 'rateLimited',
      retryAfterSec: 30,
    });
    expect(classifyTotpFailure(503, null, null).key).toBe('generic');
    expect(parseRetryAfter('0')).toBeNull();
  });

  it('parola doğru yanıtı yalnız twoFactorRedirect ile TOTP adımına geçirir', () => {
    expect(needsTotp({ twoFactorRedirect: true })).toBe(true);
    expect(needsTotp({ token: 'x', user: {} })).toBe(false);
    expect(needsTotp(null)).toBe(false);
  });
});

describe('KK-P27a-10: arayüz metinleri', () => {
  it('giriş ve step-up metinleri yöntem-nötrdür; tüm hata anahtarları tanımlıdır', () => {
    const login = messages.login as Record<string, unknown>;
    const errors = login.errors as Record<string, string>;
    for (const key of [
      'invalidCredentials',
      'invalidCode',
      'challengeExpired',
      'rateLimited',
      'rateLimitedWait',
      'passkeyFailed',
      'enrollFailed',
      'generic',
    ]) {
      expect(typeof errors[key], key).toBe('string');
    }
    expect(String(login.intro)).toContain('2 adımlı doğrulama');
    expect(String(login.passkey)).toBe('Geçiş anahtarıyla giriş');
    expect(String(login.enrolled)).toContain('Kayıt tamamlandı');
    const stepUp = messages.stepUp as Record<string, string>;
    expect(stepUp.body).not.toMatch(/geçiş anahtar|passkey/i);
    expect(stepUp.confirm).not.toMatch(/geçiş anahtar|passkey/i);
  });

  it('yazma ekranı açıklamaları yöntem-nötrdür', () => {
    const text = JSON.stringify(messages);
    expect(text).not.toContain('geçiş anahtarıyla yeniden doğrulama ister');
    expect(text).not.toContain('passkey ile yeniden doğrulama');
  });
});
