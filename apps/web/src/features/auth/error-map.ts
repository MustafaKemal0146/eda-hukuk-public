// Kimlik hata kodu -> arayüz metin anahtarı (053-01 §3.3). Bilinmeyen kod genel hataya düşer;
// ham İngilizce ileti kullanıcıya gösterilmez. "Hesap kilitlendi" ifadesi yoktur (Y-46).
import type { AuthApiError } from '../../lib/auth-api.ts';

export type AuthErrorKey =
  | 'invalidCredentials'
  | 'emailNotVerified'
  | 'rateLimited'
  | 'suspended'
  | 'orgSuspended'
  | 'maintenance'
  | 'network'
  | 'invalidCode'
  | 'invalidLink'
  | 'weakPassword'
  | 'validation'
  | 'mfaRequired'
  | 'invitationInvalid'
  | 'invitationEmailMismatch'
  | 'seatLimit'
  | 'generic';

export function authErrorKey(e: AuthApiError): AuthErrorKey {
  if (e.code === 'CLIENT_NETWORK' || e.status === 0) return 'network';
  if (e.status === 429 || e.code === 'RATE_LIMITED') return 'rateLimited';
  if (e.status === 503 || e.code === 'INTERNAL_MAINTENANCE') return 'maintenance';
  switch (e.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
    case 'AUTH_INVALID_CREDENTIALS':
    case 'INVALID_PASSWORD':
    case 'USER_NOT_FOUND':
      return 'invalidCredentials';
    case 'EMAIL_NOT_VERIFIED':
      return 'emailNotVerified';
    case 'AUTH_SUSPENDED':
      return e.reason === 'org_suspended' ? 'orgSuspended' : 'suspended';
    case 'INVALID_TWO_FACTOR_COOKIE':
    case 'INVALID_CODE':
    case 'INVALID_BACKUP_CODE':
      return 'invalidCode';
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      return 'invalidLink';
    case 'PASSWORD_TOO_WEAK':
    case 'PASSWORD_TOO_SHORT':
      return 'weakPassword';
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'AUTH_MFA_REQUIRED':
      return 'mfaRequired';
    case 'INVITATION_INVALID':
    case 'INVITATION_NOT_FOUND':
      return 'invitationInvalid';
    case 'INVITATION_EMAIL_MISMATCH':
    case 'YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION':
      return 'invitationEmailMismatch';
    case 'SEAT_LIMIT_REACHED':
      return 'seatLimit';
    default:
      return 'generic';
  }
}
