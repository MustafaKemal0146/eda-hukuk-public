// Şablon kodu -> içerik üretici eşlemesi. Saf TypeScript'tir (React yok); `render.tsx` HTML + metin,
// `preview.ts` yalnız düz metin üretir. İki yol da aynı içerik bloklarını kullanır (045 §7.2).
import type { CatalogCode, TemplateParams } from './catalog.ts';
import type { EmailContent, RenderContext } from './content.ts';
import { content as backupCodesChanged } from './templates/backup-codes-changed.ts';
import { content as factorChanged } from './templates/factor-changed.ts';
import { content as invitation } from './templates/invitation.ts';
import { content as lawyerApplicationReceived } from './templates/lawyer-application-received.ts';
import { content as passwordChanged } from './templates/password-changed.ts';
import { content as passwordReset } from './templates/password-reset.ts';
import { content as registrationAttempt } from './templates/registration-attempt.ts';
import { content as verificationApproved } from './templates/verification-approved.ts';
import { content as verificationRejected } from './templates/verification-rejected.ts';
import { content as verifyEmail } from './templates/verify-email.ts';

type ContentFns = {
  readonly [C in CatalogCode]: (p: TemplateParams<C>, ctx: RenderContext) => EmailContent;
};

export const CONTENT: ContentFns = {
  verify_email: verifyEmail,
  password_reset: passwordReset,
  invitation,
  password_changed: passwordChanged,
  factor_changed: factorChanged,
  backup_codes_changed: backupCodesChanged,
  lawyer_application_received: lawyerApplicationReceived,
  verification_approved: verificationApproved,
  verification_rejected: verificationRejected,
  registration_attempt: registrationAttempt,
};
