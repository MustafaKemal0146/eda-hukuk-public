// Step-up (yeniden doğrulama; 042 §6; KK-P04b-8). Pencere `auth.stepUpWindowMin`; kanıt yöntemi
// kullanıcının MFA durumuna göre (§6.1): passkey'i olan `passkey` (TOTP'si de varsa `totp`), yalnız
// TOTP'si olan `totp`, MFA'sı olmayan `password`. Doğrulama OTURUM YARATMAZ (DK-050):
//  - parola: `accounts.password` Argon2id özetine karşı `verify` (Better Auth giriş ucu kullanılmaz);
//  - TOTP: Better Auth `verifyTOTP` oturumlu kipte (oturum oluşturmaz; tekrar kullanım koruması aynı
//    `before` kancasındadır); yalnız etkin ve doğrulanmış TOTP'de;
//  - passkey: oturumlu `passkey/generate-authenticate-options` meydan okuması (`passkey_challenge`
//    çerezi + Better Auth doğrulama kaydı, tek kullanım) + `@simplewebauthn/server` doğrulaması
//    (kullanıcı doğrulaması zorunlu, sayaç güncellenir).
// Başarıda yalnız `step_up_at = now()` yazılır (DB + Valkey oturum kaydı); `mfa_level` düşmez;
// denetim `auth.step_up` (`method`). Başarısızlık `auth-account` bekleme sayacına işler; deneme
// sınırı `step-up` kapsamıdır (`rateLimit.stepUpPerUserPerMin`; 6. hatalı deneme 429).
import type { StepUpInput, StepUpMethod, StepUpResultDto } from '@eda/contracts/api/me';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import {
  type AuthenticationResponseJSON,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RateLimiter } from '../middleware/rate-limit.ts';
import type { AuditWriter } from './audit.ts';
import { PASSKEY_CHALLENGE_COOKIE, readCookie, verifySignedCookieValue } from './cookies.ts';
import { clientIp } from './net.ts';
import type { MfaFactors, OrgStore } from './org-store.ts';

const WINDOW_MS = CONFIG_DEFAULTS['auth.stepUpWindowMin'] * 60_000;

/** `now − stepUpAt ≤ auth.stepUpWindowMin` (040 §5.10). */
export function stepUpValid(
  stepUpAt: Date | null,
  nowMs: number,
  windowMs: number = WINDOW_MS,
): boolean {
  return stepUpAt !== null && nowMs - stepUpAt.getTime() <= windowMs && stepUpAt.getTime() <= nowMs;
}

export function stepUpExpiresAt(stepUpAt: Date): Date {
  return new Date(stepUpAt.getTime() + WINDOW_MS);
}

/** Kullanıcının MFA durumuna göre kabul edilen yöntemler (042 §6.1). */
export function allowedStepUpMethods(f: MfaFactors): readonly StepUpMethod[] {
  if (f.passkeys > 0) return f.totp ? ['passkey', 'totp'] : ['passkey'];
  if (f.totp) return ['totp'];
  return ['password'];
}

export interface StepUpDeps {
  readonly store: OrgStore;
  readonly rate: RateLimiter;
  readonly audit: AuditWriter;
  readonly secret: string;
  readonly appUrl: string;
  readonly rpId: string;
  readonly now: () => Date;
  readonly verifyPassword: (hash: string, password: string) => Promise<boolean>;
  /** Oturumlu TOTP doğrulaması (oturum yaratmaz); geçerli kod true. */
  readonly verifyTotp: (headers: Headers, code: string) => Promise<boolean>;
  /** Better Auth doğrulama kaydını tek kullanımlık tüketir (değer veya null). */
  readonly consumeChallenge: (token: string) => Promise<string | null>;
  /** Oturum alanlarını DB ve Valkey kaydında günceller. */
  readonly updateSession: (token: string, fields: { stepUpAt: Date }) => Promise<void>;
}

export interface StepUpSubject {
  readonly sessionId: string;
  readonly token: string;
  readonly userId: string;
  readonly activeOrgId: string | null;
}

async function verifyPasskey(
  deps: StepUpDeps,
  subject: StepUpSubject,
  headers: Headers,
  response: Record<string, unknown>,
): Promise<boolean> {
  const token = verifySignedCookieValue(
    readCookie(headers.get('cookie'), PASSKEY_CHALLENGE_COOKIE),
    deps.secret,
  );
  if (token === null) return false;
  const raw = await deps.consumeChallenge(token);
  if (raw === null) return false;
  let challenge: { type?: unknown; expectedChallenge?: unknown; userData?: { id?: unknown } };
  try {
    challenge = JSON.parse(raw) as typeof challenge;
  } catch {
    return false;
  }
  if (
    challenge.type !== 'authentication' ||
    typeof challenge.expectedChallenge !== 'string' ||
    challenge.userData?.id !== subject.userId
  ) {
    return false;
  }
  const id = response.id;
  if (typeof id !== 'string') return false;
  const pk = await deps.store.passkeyByCredential(id);
  if (pk === null || pk.userId !== subject.userId) return false;
  try {
    const v = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge.expectedChallenge,
      expectedOrigin: deps.appUrl,
      expectedRPID: deps.rpId,
      credential: {
        id: pk.credentialId,
        publicKey: new Uint8Array(Buffer.from(pk.publicKey, 'base64')),
        counter: pk.counter,
      },
      requireUserVerification: true,
    });
    if (!v.verified) return false;
    await deps.store.setPasskeyCounter(pk.id, v.authenticationInfo.newCounter);
    return true;
  } catch {
    return false;
  }
}

export async function performStepUp(
  deps: StepUpDeps,
  subject: StepUpSubject,
  input: StepUpInput,
  headers: Headers,
): Promise<StepUpResultDto> {
  const ip = clientIp(headers);
  const user = await deps.store.user(subject.userId);
  if (user === null) throw new AppError('AUTH_UNAUTHENTICATED');
  await deps.rate.enforce(
    'step-up',
    subject.userId,
    CONFIG_DEFAULTS['rateLimit.stepUpPerUserPerMin'],
    60_000,
  );
  const wait = await deps.rate.backoffRemainingSec(user.email, ip);
  if (wait > 0) {
    throw new AppError('RATE_LIMITED', { reason: 'auth_account', meta: { retryAfterSec: wait } });
  }
  const factors = await deps.store.mfaFactors(subject.userId);
  if (!allowedStepUpMethods(factors).includes(input.method)) {
    throw new AppError('AUTH_FORBIDDEN', { reason: 'policy_denied' });
  }
  let ok = false;
  if (input.method === 'password') {
    const hash = await deps.store.credentialHash(subject.userId);
    ok = hash !== null && (await deps.verifyPassword(hash, input.password));
  } else if (input.method === 'totp') {
    ok = await deps.verifyTotp(headers, input.code);
  } else {
    ok = await verifyPasskey(deps, subject, headers, input.response);
  }
  if (!ok) {
    await deps.rate.recordFailure(user.email, ip);
    throw new AppError('VALIDATION_FAILED', { reason: 'token_invalid' });
  }
  await deps.rate.resetFailures(user.email, ip);
  const at = deps.now();
  await deps.updateSession(subject.token, { stepUpAt: at });
  await deps.audit({
    action: 'auth.step_up',
    userId: subject.userId,
    orgId: subject.activeOrgId,
    targetType: 'session',
    targetId: subject.sessionId,
    metadata: { method: input.method },
  });
  return { stepUpAt: at.toISOString(), expiresAt: stepUpExpiresAt(at).toISOString() };
}
