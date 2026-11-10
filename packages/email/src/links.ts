// Tek bağlantı üreticisi (045 §4.2 madde 4; 002 §26 madde 89). Bağlantılar yalnız `APP_URL`
// kökenlidir ve `https` olmalıdır; belirteç sorgu dizesinde değil URL parçasında (`#token=`) taşınır.
// Şablonlar ham `href` yazmaz; yalnız bu dosyanın çıktısını kullanır.

export class LinkError extends Error {
  override name = 'LinkError';
}

export interface Links {
  readonly origin: string;
  verifyEmail(token: string): string;
  resetPassword(token: string): string;
  invitation(invitationId: string): string;
  chat(): string;
}

const TOKEN_RE = /^[A-Za-z0-9._~-]{16,512}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function assertToken(token: string): string {
  if (!TOKEN_RE.test(token)) throw new LinkError('bağlantı belirteci beklenen biçimde değil');
  return token;
}

/** `appUrl` (`APP_URL`) yalnız https kökü olabilir (yol, sorgu, parça yok). */
export function createLinks(appUrl: string): Links {
  let u: URL;
  try {
    u = new URL(appUrl);
  } catch {
    throw new LinkError('APP_URL geçerli bir adres değil');
  }
  if (
    u.protocol !== 'https:' ||
    u.search !== '' ||
    u.hash !== '' ||
    (u.pathname !== '/' && u.pathname !== '')
  ) {
    throw new LinkError('APP_URL https kökü olmalı (yol, sorgu ve parça olmadan)');
  }
  const origin = u.origin;
  return {
    origin,
    verifyEmail: (token) => `${origin}/eposta-dogrulama#token=${assertToken(token)}`,
    resetPassword: (token) => `${origin}/sifre-sifirla#token=${assertToken(token)}`,
    invitation: (invitationId) => {
      if (!UUID_RE.test(invitationId)) throw new LinkError('davet kimliği beklenen biçimde değil');
      return `${origin}/davet/${invitationId}`;
    },
    chat: () => `${origin}/sohbet`,
  };
}
