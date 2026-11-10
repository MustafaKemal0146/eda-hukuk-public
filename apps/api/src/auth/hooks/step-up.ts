// `/api/auth/*` step-up kapısı (042 §2.6 "hooks.before", §6.2; KK-P04b-8): Better Auth'tan ÖNCE Hono
// katmanında. `change-password`, `two-factor/disable`, `two-factor/generate-backup-codes`,
// `passkey/delete-passkey` son `auth.stepUpWindowMin` içinde step-up ister (403
// `AUTH_STEP_UP_REQUIRED`, `actions: ["step_up"]`); TOTP ve passkey kaldırmada zorunlu rolün SON
// yöntemi kaldırılamaz (403 `AUTH_FORBIDDEN`, `reason: mfa_required_role`; 042 §5.5). Oturum yoksa
// karar Better Auth'a bırakılır (401). Gövde okunmaz.
import { AppError } from '@eda/contracts/errors';
import { STEP_UP_AUTH_PATHS } from '../allowlist.ts';
import type { ResolvedSession } from '../index.ts';
import { stepUpValid } from '../step-up.ts';

export interface AuthStepUpGateDeps {
  getSession(headers: Headers): Promise<ResolvedSession | null>;
  /** Kaldırma sonrası yöntem kalmıyorsa ve MFA zorunluysa fırlatır. */
  assertCanRemoveFactor(userId: string, kind: 'totp' | 'passkey'): Promise<void>;
}

export async function enforceAuthStepUp(
  deps: AuthStepUpGateDeps,
  sub: string,
  headers: Headers,
  nowMs: number = Date.now(),
): Promise<void> {
  if (!STEP_UP_AUTH_PATHS.has(sub)) return;
  const r = await deps.getSession(headers);
  if (r === null) return;
  if (!stepUpValid(r.session.stepUpAt, nowMs)) {
    throw new AppError('AUTH_STEP_UP_REQUIRED', { actions: ['step_up'] });
  }
  if (sub === '/two-factor/disable') await deps.assertCanRemoveFactor(r.user.id, 'totp');
  if (sub === '/passkey/delete-passkey') await deps.assertCanRemoveFactor(r.user.id, 'passkey');
}
