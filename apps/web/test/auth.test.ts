import { describe, expect, it } from 'vitest';
import { authErrorKey } from '../src/features/auth/error-map.ts';
import { AuthApiError } from '../src/lib/auth-api.ts';
import { DEFAULT_NEXT, safeNext } from '../src/lib/safe-next.ts';

const err = (code: string, status = 400, reason: string | null = null) =>
  new AuthApiError({ status, code, message: '', reason });

describe('KK-P04c-2: açık yönlendirme üretilmez (053-01 KK-2)', () => {
  it.each([
    '//evil.example',
    'https://evil.example',
    '/ayarlar?x=1',
    '/a#b',
    '/\\evil',
    'javascript:alert(1)',
    '/%2F%2Fevil',
    '',
    `/${'a'.repeat(300)}`,
  ])('%s -> /sohbet', (raw) => {
    expect(safeNext(raw)).toBe(DEFAULT_NEXT);
  });
  it('uygulama içi yolu korur', () => {
    expect(safeNext('/belgeler')).toBe('/belgeler');
    expect(safeNext('/davet/0199-abc')).toBe('/davet/0199-abc');
    expect(safeNext(null)).toBe(DEFAULT_NEXT);
  });
});

describe('KK-P04c-1: hata eşleme hesap varlığını sızdırmaz, kilit ifadesi yok (053-01 KK-1)', () => {
  it('yanlış e-posta ve yanlış parola aynı anahtara düşer', () => {
    expect(authErrorKey(err('INVALID_EMAIL_OR_PASSWORD', 401))).toBe('invalidCredentials');
    expect(authErrorKey(err('USER_NOT_FOUND', 401))).toBe('invalidCredentials');
    expect(authErrorKey(err('INVALID_PASSWORD', 401))).toBe('invalidCredentials');
  });
  it('hız sınırı, bakım, ağ ve askı ayrı anahtarlardır', () => {
    expect(authErrorKey(err('RATE_LIMITED', 429))).toBe('rateLimited');
    expect(authErrorKey(err('X', 503))).toBe('maintenance');
    expect(authErrorKey(err('CLIENT_NETWORK', 0))).toBe('network');
    expect(authErrorKey(err('AUTH_SUSPENDED', 403))).toBe('suspended');
    expect(authErrorKey(err('AUTH_SUSPENDED', 403, 'org_suspended'))).toBe('orgSuspended');
  });
  it('bilinmeyen kod genel hataya düşer', () => {
    expect(authErrorKey(err('ŞU_KOD_YOK', 418))).toBe('generic');
  });
  it('davet hataları birleşik metne gider', () => {
    expect(authErrorKey(err('INVITATION_INVALID', 400))).toBe('invitationInvalid');
    expect(authErrorKey(err('SEAT_LIMIT_REACHED', 409))).toBe('seatLimit');
  });
});
