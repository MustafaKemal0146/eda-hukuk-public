// Better Auth yol izin listesi (042 §2.9; KK-042-2, KK-P04b-5). `/api/auth/*` isteği Better Auth'a
// verilmeden önce bu listeyle süzülür; listede olmayan yol ve yöntem 404 (`notFound` zarfı). Yol adları
// ve yöntemleri kurulu better-auth 1.7.7 ve @better-auth/passkey 1.7.7 kaynağından doğrulandı
//: doğrulama GET `verify-email?token=`, sıfırlama
// isteği POST `request-password-reset`; passkey seçenek uçları GET. Büro yönetimi (`organization/create|
// update|delete|invite-member|remove-member|update-member-role|leave|…`) `/api/v1/org/*`'dadır; burada
// yalnız aktif büro, davet okuma/kabul/ret açıktır. `two-factor/get-totp-uri` kapalıdır (kurulum URI'si
// yalnız `enable` yanıtında döner).

export const AUTH_BASE_PATH = '/api/auth';

/** `/api/auth` sonrası yol -> izinli HTTP yöntemleri. */
export const AUTH_PATH_ALLOWLIST: Readonly<Record<string, readonly ('GET' | 'POST')[]>> = {
  '/sign-up/email': ['POST'],
  '/sign-in/email': ['POST'],
  '/sign-out': ['POST'],
  '/get-session': ['GET'],
  '/revoke-sessions': ['POST'],
  '/revoke-other-sessions': ['POST'],
  '/send-verification-email': ['POST'],
  '/verify-email': ['GET'],
  '/request-password-reset': ['POST'],
  '/reset-password': ['POST'],
  '/change-password': ['POST'],
  '/two-factor/enable': ['POST'],
  '/two-factor/disable': ['POST'],
  '/two-factor/verify-totp': ['POST'],
  '/two-factor/verify-backup-code': ['POST'],
  '/two-factor/generate-backup-codes': ['POST'],
  '/passkey/generate-register-options': ['GET'],
  '/passkey/verify-registration': ['POST'],
  '/passkey/generate-authenticate-options': ['GET'],
  '/passkey/verify-authentication': ['POST'],
  '/passkey/list-user-passkeys': ['GET'],
  '/passkey/delete-passkey': ['POST'],
  '/passkey/update-passkey': ['POST'],
  '/organization/set-active': ['POST'],
  '/organization/get-invitation': ['GET'],
  '/organization/accept-invitation': ['POST'],
  '/organization/reject-invitation': ['POST'],
};

/** `auth-ip` kapsamına giren yollar (042 §11.1; `get-session`/`list-sessions` hariç). */
export const AUTH_IP_LIMITED: ReadonlySet<string> = new Set([
  '/sign-up/email',
  '/sign-in/email',
  '/send-verification-email',
  '/verify-email',
  '/request-password-reset',
  '/reset-password',
  '/two-factor/enable',
  '/two-factor/disable',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/two-factor/generate-backup-codes',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
]);

/**
 * Doğrulama / sıfırlama / kayıt e-postası tetikleyen yollar: IP başına ve platform genelinde günlük
 * tavan (`email.perIpDailyCap`, `email.globalDailyCap`; `auth/handler.ts`).
 */
export const AUTH_EMAIL_TRIGGERING: ReadonlySet<string> = new Set([
  '/sign-up/email',
  '/send-verification-email',
  '/request-password-reset',
]);

/**
 * Better Auth'tan ÖNCE Hono katmanında step-up isteyen kimlik yolları (042 §6.2 "Kimlik bilgisi
 * değişikliği"; `hooks/step-up.ts`). Route census'un `/api/auth/*` karşılığıdır (KK-P04b-8).
 */
export const STEP_UP_AUTH_PATHS: ReadonlySet<string> = new Set([
  '/change-password',
  '/two-factor/disable',
  '/two-factor/generate-backup-codes',
  '/passkey/delete-passkey',
  // Passkey EKLEME (Y-1): yeni yöntem kendini ispat etmez; çalınmış çerez kalıcı arka kapı bırakırdı.
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
]);

/**
 * Savunma derinliği: Better Auth `disabledPaths` (tam yol eşleşmesi). Kurulu sürümün sunduğu ve izin
 * listesinde olmayan yollar; desenli yollar (`/reset-password/:token`, `/callback/:id`) burada
 * yazılamaz, izin listesi onları zaten 404 yapar.
 */
export const AUTH_DISABLED_PATHS: readonly string[] = [
  '/sign-in/social',
  '/update-session',
  '/verify-password',
  '/update-user',
  '/change-email',
  '/delete-user',
  '/delete-user/callback',
  '/link-social',
  '/unlink-account',
  '/list-accounts',
  '/get-access-token',
  '/refresh-token',
  '/account-info',
  '/ok',
  '/error',
  '/admin/set-role',
  '/admin/create-user',
  '/admin/update-user',
  '/admin/list-user-sessions',
  '/admin/unban-user',
  '/admin/ban-user',
  '/admin/impersonate-user',
  '/admin/stop-impersonating',
  '/admin/revoke-user-session',
  '/admin/revoke-user-sessions',
  '/admin/remove-user',
  '/admin/set-user-password',
  '/admin/has-permission',
  '/admin/get-user',
  '/admin/list-users',
  '/organization/create',
  '/organization/update',
  '/organization/delete',
  '/organization/invite-member',
  '/organization/cancel-invitation',
  '/organization/remove-member',
  '/organization/update-member-role',
  '/organization/leave',
  '/organization/list',
  '/organization/check-slug',
  '/organization/get-organization',
  '/organization/get-full-organization',
  '/organization/list-invitations',
  '/organization/list-user-invitations',
  '/organization/list-members',
  '/organization/get-active-member',
  '/organization/get-active-member-role',
  '/organization/has-permission',
  '/two-factor/get-totp-uri',
  '/two-factor/send-otp',
  '/two-factor/verify-otp',
];

/** `/api/auth/<yol>` için izin: yol listede ve yöntem izinli mi. */
export function isAllowedAuthRequest(method: string, fullPath: string): boolean {
  if (!fullPath.startsWith(`${AUTH_BASE_PATH}/`)) return false;
  const sub = fullPath.slice(AUTH_BASE_PATH.length).replace(/\/+$/, '');
  const methods = AUTH_PATH_ALLOWLIST[sub];
  return methods !== undefined && (methods as readonly string[]).includes(method);
}

export function authSubPath(fullPath: string): string {
  return fullPath.slice(AUTH_BASE_PATH.length).replace(/\/+$/, '');
}
