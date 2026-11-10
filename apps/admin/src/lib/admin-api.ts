// Yönetim api istemcisi (tarayıcı, aynı origin `/api/v1/admin/*`). Hata zarfı 044 biçimindedir; kod ve
// `requestId` korunur. Yazma uçları 403 `AUTH_STEP_UP_REQUIRED` verirse çağıran oturumdaki yönteme göre
// yeniden doğrulama yapıp (passkey: `stepUpWithPasskey`; parola+TOTP oturumu: `stepUpWithTotp`)
// işlemi bir kez yeniden dener.
import {
  classifyAdminFailure,
  isSessionEndedLatched,
  reportSessionEnded,
} from './session-guard.ts';
import { type AuthenticationOptionsJSON, getCredential } from './webauthn.ts';

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  /** 403 `ADMIN_FORBIDDEN` ayrıntısı (`passkey_required`, `permission_missing`, ...). */
  readonly reason: string | null;
  constructor(
    status: number,
    code: string,
    requestId: string | null,
    reason: string | null = null,
  ) {
    super(code);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.reason = reason;
  }
}

export async function adminFetch<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  // Oturum bitti ise ağa çıkılmaz: yoklama/yeniden deneme yapan her çağıran anında 401 görür.
  if (isSessionEndedLatched()) throw new AdminApiError(401, 'AUTH_SESSION_EXPIRED', null);
  const res = await fetch(`/api/v1/admin${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? {} : { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let requestId: string | null = null;
    let reason: string | null = null;
    try {
      const j = (await res.json()) as {
        error?: { code?: string; requestId?: string; reason?: string };
      };
      code = j.error?.code ?? code;
      requestId = j.error?.requestId ?? null;
      reason = typeof j.error?.reason === 'string' ? j.error.reason : null;
    } catch {
      // gövde okunamadı
    }
    // Tek yakalama noktası: 401 oturumun bittiği anlamına gelir (403 step-up/izin farklıdır).
    if (classifyAdminFailure(res.status, code, reason) === 'session_ended') {
      reportSessionEnded(typeof window === 'undefined' ? '' : window.location.pathname);
    }
    throw new AdminApiError(res.status, code, requestId, reason);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Passkey ile yeniden doğrulama: yeni oturum açar (step-up penceresi yenilenir). */
export async function stepUpWithPasskey(): Promise<void> {
  const opt = await fetch('/api/auth/passkey/generate-authenticate-options', {
    credentials: 'same-origin',
  });
  if (!opt.ok) throw new Error('options');
  const response = await getCredential((await opt.json()) as AuthenticationOptionsJSON);
  const res = await fetch('/api/auth/passkey/verify-authentication', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ response }),
  });
  if (!res.ok) throw new Error('verify');
}

/** Oturumun açılış yöntemi (yeniden doğrulama aynı yöntemle yapılır). */
export async function currentStepUpMethod(): Promise<'passkey' | 'totp'> {
  const me = await adminFetch<{ session: { mfaLevel: 'passkey' | 'totp' } }>('/me');
  return me.session.mfaLevel;
}

/** TOTP ile yeniden doğrulama: oturumu yenilemez, yalnız step-up penceresini açar. */
export async function stepUpWithTotp(code: string): Promise<void> {
  const res = await fetch('/api/auth/two-factor/verify-totp', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error('verify');
}

export const isStepUp = (e: unknown): boolean =>
  e instanceof AdminApiError && classifyAdminFailure(e.status, e.code, e.reason) === 'step_up';
export const isSessionGone = (e: unknown): boolean =>
  e instanceof AdminApiError &&
  classifyAdminFailure(e.status, e.code, e.reason) === 'session_ended';
/** Bölüm içinde "yetkiniz yok" gösterilecek 403 (giriş sayfasına ATILMAZ). */
export const isPermissionMissing = (e: unknown): boolean =>
  e instanceof AdminApiError &&
  classifyAdminFailure(e.status, e.code, e.reason) === 'permission_missing';
