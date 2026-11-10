// Kimlik e-postaları (042 §2.10, §11.1; 045 §7.3): Better Auth geri çağrıları buraya bağlanır.
// Adres başı saatlik sınır (`auth-email-out`) aşılırsa e-posta kuyruğa alınmaz, yanıt değişmez.
// Belirteç yalnız mühürlü sırdır; `dedupe_key` dakika (doğrulama/sıfırlama) veya saat (kayıt
// denemesi) kovasıdır.
import { createHash } from 'node:crypto';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { AuthEmails } from '../../auth/index.ts';
import { dedupeKeys, type EmailEnqueueDeps, emailEnqueue } from './email-enqueue.ts';

export interface AuthEmailsDeps {
  readonly enqueue: EmailEnqueueDeps;
  readonly allowAuthEmail: (email: string) => Promise<boolean>;
  readonly now?: () => Date;
}

const MIN = 60_000;

export function createAuthEmails(deps: AuthEmailsDeps): AuthEmails {
  const now = deps.now ?? (() => new Date());
  return {
    async verifyEmail(user, token) {
      if (!(await deps.allowAuthEmail(user.email))) return;
      const t = now();
      const ttl = CONFIG_DEFAULTS['auth.emailVerificationTtlMin'];
      await emailEnqueue(deps.enqueue, {
        template: 'verify_email',
        userId: user.id,
        dedupeKey: dedupeKeys.verifyEmail(user.id, t),
        params: { expiresInMin: ttl },
        secret: { token },
        expiresAt: new Date(t.getTime() + ttl * MIN),
      });
    },
    async passwordReset(user, token) {
      if (!(await deps.allowAuthEmail(user.email))) return;
      const t = now();
      const ttl = CONFIG_DEFAULTS['auth.passwordResetTtlMin'];
      await emailEnqueue(deps.enqueue, {
        template: 'password_reset',
        userId: user.id,
        dedupeKey: dedupeKeys.passwordReset(user.id, t),
        params: { expiresInMin: ttl },
        secret: { token },
        expiresAt: new Date(t.getTime() + ttl * MIN),
      });
    },
    async passwordChanged(user) {
      const t = now();
      await emailEnqueue(deps.enqueue, {
        template: 'password_changed',
        userId: user.id,
        dedupeKey: dedupeKeys.passwordChanged(user.id, t),
        params: { changedAt: t.toISOString() },
        expiresAt: new Date(
          t.getTime() + CONFIG_DEFAULTS['notifications.serviceEmailExpiryHours'] * 60 * MIN,
        ),
      });
    },
    async invitation(inviterId, invitationId, role, expiresAt) {
      // Davet kimliği taşıyıcı belirteçtir: yalnız mühürlü sır; dedupe anahtarı özetten.
      const digest = createHash('sha256').update(invitationId).digest('hex').slice(0, 32);
      return emailEnqueue(deps.enqueue, {
        template: 'invitation',
        userId: inviterId,
        invitationId,
        dedupeKey: dedupeKeys.invitation(digest),
        params: { role, expiresInHours: CONFIG_DEFAULTS['auth.inviteTtlHours'] },
        secret: { token: invitationId },
        expiresAt,
      });
    },
    async factorChanged(user, factor, action) {
      const t = now();
      await emailEnqueue(deps.enqueue, {
        template: 'factor_changed',
        userId: user.id,
        dedupeKey: dedupeKeys.factorChanged(user.id, factor, action, t),
        params: { factor, action, changedAt: t.toISOString() },
        expiresAt: new Date(
          t.getTime() + CONFIG_DEFAULTS['notifications.serviceEmailExpiryHours'] * 60 * MIN,
        ),
      });
    },
    async registrationAttempt(user) {
      if (!(await deps.allowAuthEmail(user.email))) return;
      const t = now();
      await emailEnqueue(deps.enqueue, {
        template: 'registration_attempt',
        userId: user.id,
        dedupeKey: dedupeKeys.registrationAttempt(user.id, t),
        params: { attemptAt: t.toISOString() },
        expiresAt: new Date(
          t.getTime() + CONFIG_DEFAULTS['notifications.serviceEmailExpiryHours'] * 60 * MIN,
        ),
      });
    },
  };
}

/** `lawyer_application_received` (045 §7.3; service). */
export function createApplicationReceivedSender(
  enqueue: EmailEnqueueDeps,
  now: () => Date = () => new Date(),
) {
  return async (userId: string, submittedAt: Date): Promise<void> => {
    const t = now();
    await emailEnqueue(enqueue, {
      template: 'lawyer_application_received',
      userId,
      dedupeKey: dedupeKeys.applicationReceived(userId, submittedAt),
      params: { slaBusinessHours: CONFIG_DEFAULTS['auth.verificationSlaBusinessHours'] },
      expiresAt: new Date(
        t.getTime() + CONFIG_DEFAULTS['notifications.serviceEmailExpiryHours'] * 60 * MIN,
      ),
    });
  };
}
