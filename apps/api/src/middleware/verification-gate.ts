// Meslek doğrulama kapısı (042 §3.2; 040 §5.10; KK-042-5). Tablo:
//   meta \ durum | verified | pending_verification       | rejected                              | suspended
//   verified     | evet     | AUTH_PENDING_VERIFICATION | AUTH_FORBIDDEN (verification_rejected)| AUTH_SUSPENDED
//   pending      | evet     | evet                      | AUTH_FORBIDDEN (verification_rejected)| AUTH_SUSPENDED
//   any          | evet     | evet                      | evet                                  | AUTH_SUSPENDED*
// (*) `GET /me`, çıkış, destek ve KVKK uçları askıdaki kullanıcıya da açıktır.
import type { VerificationStatus } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import type { MiddlewareHandler } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';

/** Askıdaki kullanıcının da erişebildiği `any` uçları (P04a'da kayıtlı olanlar). */
export const SUSPENDED_ALLOWED: ReadonlySet<string> = new Set(['GET /api/v1/me']);

export function gateDecision(
  allow: RouteMeta['allowVerification'],
  status: VerificationStatus,
  routeKey: string,
): AppError | null {
  if (status === 'suspended') {
    return allow === 'any' && SUSPENDED_ALLOWED.has(routeKey)
      ? null
      : new AppError('AUTH_SUSPENDED', { reason: 'user_suspended' });
  }
  if (status === 'verified' || allow === 'any') return null;
  if (status === 'rejected')
    return new AppError('AUTH_FORBIDDEN', { reason: 'verification_rejected' });
  // pending_verification
  return allow === 'pending' ? null : new AppError('AUTH_PENDING_VERIFICATION');
}

export function verificationGate(): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    const u = c.get('user');
    if (meta === undefined || u === undefined) return next();
    const err = gateDecision(meta.allowVerification, u.verificationStatus, c.get('routeKey') ?? '');
    if (err !== null) throw err;
    await next();
  };
}
