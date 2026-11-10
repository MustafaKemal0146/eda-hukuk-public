// Oturum yönetimi istemcisi (aynı origin `/api/v1/me/sessions`). Yanıtlar belirteç taşımaz; iptal
// kimlikle yapılır. Hata zarfı `AuthApiError` ile aynıdır.
import {
  RevokeSessionsResult,
  type SessionDeviceDtoValue,
  SessionListResponse,
} from '@eda/contracts/api/me';
import { AuthApiError } from '../../lib/auth-api.ts';
import { guardedFetch } from '../../lib/session-guard.ts';

async function call(path: string, method: 'GET' | 'POST' | 'DELETE'): Promise<unknown> {
  let res: Response;
  try {
    res = await guardedFetch(path, { method, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: 'network' });
  }
  if (res.status === 204) return null;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const e = (body.error ?? {}) as Record<string, unknown>;
    throw new AuthApiError({
      status: res.status,
      code: typeof e.code === 'string' ? e.code : `HTTP_${res.status}`,
      message: typeof e.message === 'string' ? e.message : '',
      requestId: typeof e.requestId === 'string' ? e.requestId : null,
    });
  }
  return body;
}

export async function loadSessions(): Promise<SessionDeviceDtoValue[]> {
  return SessionListResponse.parse(await call('/api/v1/me/sessions', 'GET')).items;
}

export async function revokeSession(id: string): Promise<void> {
  await call(`/api/v1/me/sessions/${encodeURIComponent(id)}`, 'DELETE');
}

export async function revokeOtherSessions(): Promise<number> {
  return RevokeSessionsResult.parse(await call('/api/v1/me/sessions/revoke-others', 'POST'))
    .revoked;
}
