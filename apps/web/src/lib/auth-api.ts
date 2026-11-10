// Kimlik uçlarına tarayıcıdan aynı origin çağrıları (Better Auth `/api/auth/*` ve `/api/v1/me`).
// Server Action/Route Handler yok (Y-yasak); yanıt gövdesi iki biçimden biri olabilir:
// `{ error: { code, message, ... } }` (api zarfı) veya `{ code, message }` (Better Auth).
import { guardedFetch } from './session-guard.ts';
import { uuidv7 } from './uuid.ts';

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryAfterSec: number | null;
  readonly requestId: string | null;
  readonly reason: string | null;
  constructor(init: {
    status: number;
    code: string;
    message: string;
    retryAfterSec?: number | null;
    requestId?: string | null;
    reason?: string | null;
  }) {
    super(init.message);
    this.name = 'AuthApiError';
    this.status = init.status;
    this.code = init.code;
    this.retryAfterSec = init.retryAfterSec ?? null;
    this.requestId = init.requestId ?? null;
    this.reason = init.reason ?? null;
  }
}

type Json = Record<string, unknown>;

async function call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }): Promise<Json> {
  let res: Response;
  try {
    res = await guardedFetch(path, {
      method: init.method,
      credentials: 'same-origin',
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
  let body: Json = {};
  try {
    body = text === '' ? {} : (JSON.parse(text) as Json);
  } catch {
    body = {};
  }
  if (res.ok) return body;
  const env = (body.error ?? body) as Json;
  const retry = Number(res.headers.get('retry-after'));
  throw new AuthApiError({
    status: res.status,
    code: typeof env.code === 'string' ? env.code : `HTTP_${res.status}`,
    message: typeof env.message === 'string' ? env.message : '',
    retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : null,
    requestId: typeof env.requestId === 'string' ? env.requestId : null,
    reason: typeof env.reason === 'string' ? env.reason : null,
  });
}

const post = (path: string, body: unknown) => call(path, { method: 'POST', body });
const get = (path: string) => call(path, { method: 'GET' });

export type SignInResult = { kind: 'session' } | { kind: 'two_factor' };

export async function signInEmail(input: {
  email: string;
  password: string;
  rememberMe: boolean;
}): Promise<SignInResult> {
  const body = await post('/api/auth/sign-in/email', input);
  return body.twoFactorRedirect === true ? { kind: 'two_factor' } : { kind: 'session' };
}

export const signUpEmail = (input: {
  name: string;
  email: string;
  password: string;
  acceptTerms: true;
  acknowledgePrivacy: true;
  callbackURL?: string;
  invitationToken?: string;
}) => post('/api/auth/sign-up/email', input);

export const sendVerificationEmail = (input: { email: string; callbackURL?: string }) =>
  post('/api/auth/send-verification-email', input);

export const verifyEmail = (token: string) =>
  get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);

export const requestPasswordReset = (input: { email: string; redirectTo: string }) =>
  post('/api/auth/request-password-reset', input);

export const resetPassword = (input: { newPassword: string; token: string }) =>
  post('/api/auth/reset-password', input);

export const verifyTotp = (code: string) => post('/api/auth/two-factor/verify-totp', { code });
export const verifyBackupCode = (code: string) =>
  post('/api/auth/two-factor/verify-backup-code', { code });

export async function enableTotp(
  password: string,
): Promise<{ totpURI: string; backupCodes: string[] }> {
  const body = await post('/api/auth/two-factor/enable', { password });
  return {
    totpURI: String(body.totpURI ?? ''),
    backupCodes: Array.isArray(body.backupCodes) ? body.backupCodes.map(String) : [],
  };
}

export const signOut = () => post('/api/auth/sign-out', {});

export type MeSummary = {
  verificationStatus: string;
  hasProfile: boolean;
  mfaLevel: string;
  mfaRequired: boolean;
  twoFactorEnabled: boolean;
  hasPasskey: boolean;
  memberships: { orgId: string; role: string }[];
};

export async function getMe(): Promise<MeSummary> {
  const b = await get('/api/v1/me');
  const user = (b.user ?? {}) as Json;
  const session = (b.session ?? {}) as Json;
  const active = (b.activeOrg ?? null) as Json | null;
  const mfa = (active?.mfa ?? null) as Json | null;
  const memberships = Array.isArray(b.memberships) ? (b.memberships as Json[]) : [];
  return {
    verificationStatus: String(user.verificationStatus ?? ''),
    hasProfile: b.profile !== null && b.profile !== undefined,
    mfaLevel: String(session.mfaLevel ?? 'none'),
    mfaRequired: mfa?.required === true,
    twoFactorEnabled: user.twoFactorEnabled === true,
    hasPasskey: user.hasPasskey === true,
    memberships: memberships.map((m) => ({ orgId: String(m.orgId), role: String(m.role) })),
  };
}

export const submitLawyerApplication = (input: {
  kind: 'lawyer' | 'trainee';
  baro: string;
  sicilNo?: string;
  traineeRegistryNo?: string;
  partnerCode?: string;
  declareProfession: true;
  invitationId?: string;
}) => post('/api/v1/me/lawyer-application', input);

export const getInvitation = (id: string) =>
  get(`/api/auth/organization/get-invitation?id=${encodeURIComponent(id)}`);
export const acceptInvitation = (invitationId: string) =>
  post('/api/auth/organization/accept-invitation', { invitationId });
export const rejectInvitation = (invitationId: string) =>
  post('/api/auth/organization/reject-invitation', { invitationId });
export const setActiveOrganization = (organizationId: string) =>
  post('/api/auth/organization/set-active', { organizationId });

export type Account = { name: string; email: string; verificationStatus: string };

/** Oturum açmış kullanıcının görünen bilgisi; oturum yoksa `null`. */
export async function getAccount(): Promise<Account | null> {
  try {
    const b = await get('/api/v1/me');
    const u = (b.user ?? {}) as Json;
    return {
      name: String(u.name ?? ''),
      email: String(u.email ?? ''),
      verificationStatus: String(u.verificationStatus ?? ''),
    };
  } catch (e) {
    if (e instanceof AuthApiError && (e.status === 401 || e.status === 403)) return null;
    return null;
  }
}
