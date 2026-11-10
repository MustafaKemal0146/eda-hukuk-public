// MFA politika matrisi (042 §5.1; KK-042-10): saf fonksiyon. `mfaGate`, `requireMfaForClientData()`,
// `GET /me` (`activeOrg.mfa`) ve MFA yöntemi kaldırma kuralı (§5.5) aynı fonksiyonu kullanır.
//   büro owner/admin + kind = firm         -> her zaman (`mfa_required_role`)
//   büro owner/admin + kind = individual   -> yalnız `clientData` anında (`mfa_required_client_data`)
//   org_settings.mfa_required_all = true   -> tüm roller (`mfa_required_org`)
//   diğer roller                           -> zorunlu değil
// Platform personeli uygulama yüzeyinde oturum açamaz (§2.2); admin yüzeyi kuralı P27'dedir.
import type { MemberRole, OrgKind } from '@eda/contracts/enums';

export type MfaRequiredReason =
  | 'mfa_required_role'
  | 'mfa_required_org'
  | 'mfa_required_client_data';

export interface MfaPolicyInput {
  readonly memberRole: MemberRole;
  readonly orgKind: OrgKind;
  readonly mfaRequiredAll: boolean;
}

export type MfaDecision =
  | { readonly required: false; readonly reason: null }
  | { readonly required: true; readonly reason: MfaRequiredReason };

const NOT_REQUIRED: MfaDecision = { required: false, reason: null };
const MANAGERS: ReadonlySet<MemberRole> = new Set(['owner', 'admin']);

/** Üyelik bağlamı yoksa (aktif büro yok) zorunluluk yoktur. */
export function mfaRequired(m: MfaPolicyInput | null, clientData: boolean): MfaDecision {
  if (m === null) return NOT_REQUIRED;
  if (MANAGERS.has(m.memberRole) && m.orgKind === 'firm') {
    return { required: true, reason: 'mfa_required_role' };
  }
  if (m.mfaRequiredAll) return { required: true, reason: 'mfa_required_org' };
  if (MANAGERS.has(m.memberRole) && clientData) {
    return { required: true, reason: 'mfa_required_client_data' };
  }
  return NOT_REQUIRED;
}

/**
 * Yöntem kaldırma kuralı (042 §5.5): kullanıcının herhangi bir etkin üyeliğinde MFA her zaman
 * zorunluysa (istemci verisi anına bağlı olmadan) son yöntem kaldırılamaz.
 */
export function mfaAlwaysRequired(memberships: readonly MfaPolicyInput[]): boolean {
  return memberships.some((m) => mfaRequired(m, false).required);
}

/**
 * `clientData: true` rotalar (042 §5.1 "ilk müvekkil verisi anı"; route census KK-P04b-10 eşleşmesi).
 * Rotalar ilgili promptlarda kaydedilir; kayıtlı her rota bu listeyle eşleşmelidir.
 */
export const CLIENT_DATA_ROUTES: readonly string[] = [
  'POST /api/v1/files',
  'POST /api/v1/documents',
  'POST /api/v1/documents/import',
  'POST /api/v1/kunye-checks',
  'POST /api/v1/clients',
  'POST /api/v1/cases',
  'POST /api/v1/cases/{caseId}/parties',
  'POST /api/v1/conversations/{conversationId}/messages',
];
