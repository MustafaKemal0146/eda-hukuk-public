// Ayarlar verisi (P23 ilk dilim): aynı origin `/api/v1/me` okuması ve Better Auth
// `change-password` mutasyonu. Server Action/Route Handler yok; hata zarfı `lib/auth-api.ts` ile
// aynıdır (`AuthApiError` yeniden kullanılır), sır veya içerik loglanmaz.
import { AuthApiError } from '../../lib/auth-api.ts';
import { guardedFetch } from '../../lib/session-guard.ts';
import { uuidv7 } from '../../lib/uuid.ts';
import { type SettingsModel, settingsModelOf } from './settings-model.ts';

async function send(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<unknown> {
  let res: Response;
  try {
    res = await guardedFetch(path, {
      method: init.method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'x-request-id': uuidv7(),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
  } catch {
    throw new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: 'network' });
  }
  const text = await res.text();
  let body: unknown = {};
  try {
    body = text === '' ? {} : (JSON.parse(text) as unknown);
  } catch {
    body = {};
  }
  if (res.ok) return body;
  const env = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
  const inner = (env.error ?? env) as Record<string, unknown>;
  const retry = Number(res.headers.get('retry-after'));
  throw new AuthApiError({
    status: res.status,
    code: typeof inner.code === 'string' ? inner.code : `HTTP_${res.status}`,
    message: typeof inner.message === 'string' ? inner.message : '',
    retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null,
    requestId: typeof inner.requestId === 'string' ? inner.requestId : null,
    reason: typeof inner.reason === 'string' ? inner.reason : null,
  });
}

/** Oturum bilgisi; oturum yoksa 401 fırlatır (ekran "giriş gerekli" durumuna düşer). */
export async function loadSettings(): Promise<SettingsModel> {
  return settingsModelOf(await send('/api/v1/me', { method: 'GET' }));
}

/**
 * Parola değişimi (042 §5.2): diğer cihazlardaki oturumlar kapatılır. Sunucu, MFA/step-up
 * gerektiriyorsa `AUTH_MFA_REQUIRED` benzeri bir kod döner; ekran doğrulama yönlendirmesi gösterir.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await send('/api/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword, revokeOtherSessions: true },
  });
}
