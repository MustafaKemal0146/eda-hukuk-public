// @tk TK-28
// P27a yönetim kabuğu: rol-menü matrisi, etkin yol ve WebAuthn base64url kodlaması.
import { describe, expect, it } from 'vitest';
import { isActive, NAV, navFor } from '../src/features/shell/nav.ts';
import { AdminApiError, isSessionGone, isStepUp } from '../src/lib/admin-api.ts';
import { b64uToBytes, bytesToB64u } from '../src/lib/webauthn.ts';

describe('KK-P27a-7: rol-menü matrisi', () => {
  it('super_admin tüm uygulanmış modülleri görür; support yalnız rolünde işaretli olanları', () => {
    expect(navFor('super_admin').map((n) => n.key)).toEqual(NAV.map((n) => n.key));
    expect(navFor('support')).toEqual(NAV.filter((n) => n.roles.includes('support')));
    expect(navFor('support').every((n) => n.roles.includes('support'))).toBe(true);
    expect(navFor('support').map((n) => n.key)).not.toContain('overview');
    expect(navFor('support').map((n) => n.key)).toEqual([
      'users',
      'announcements',
      'templates',
      'support',
      'datasets',
      'audit',
    ]);
  });

  it('kök yol yalnız tam eşleşmede etkin; alt yollar üst modülü etkin yapar', () => {
    expect(isActive('/', '/')).toBe(true);
    expect(isActive('/basvurular', '/')).toBe(false);
    expect(isActive('/basvurular', '/basvurular')).toBe(true);
    expect(isActive('/istatistikler/detay', '/istatistikler')).toBe(true);
    expect(isActive('/istatistikleri', '/istatistikler')).toBe(false);
  });
});

describe('KK-P27a-8: WebAuthn kodlaması ve hata ayrımı', () => {
  it('base64url gidiş-dönüş; dolgu ve URL güvenli karakterler', () => {
    const bytes = new Uint8Array([251, 255, 190, 0, 1, 2, 250]);
    const enc = bytesToB64u(bytes.buffer);
    expect(enc).not.toMatch(/[+/=]/);
    expect([...b64uToBytes(enc)]).toEqual([...bytes]);
  });

  it('step-up ve oturum bitişi hataları ayrışır', () => {
    expect(isStepUp(new AdminApiError(403, 'AUTH_STEP_UP_REQUIRED', null))).toBe(true);
    expect(isStepUp(new AdminApiError(403, 'ADMIN_FORBIDDEN', null))).toBe(false);
    expect(isSessionGone(new AdminApiError(401, 'AUTH_UNAUTHENTICATED', null))).toBe(true);
    expect(isSessionGone(new Error('x'))).toBe(false);
  });
});
