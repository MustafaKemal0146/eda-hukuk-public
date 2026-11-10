// Ayarlar ekranı modeli (P23 ilk dilim; 053-08): `/api/v1/me` (041 §2.1) gövdesinden görünüm
// modelini türetir, parola ön denetimini ve step-up hedefini verir. Ağ erişimi ve React YOK:
// tarayıcı testleri bu saf işlevleri doğrudan çağırır.
import { PASSWORD_MIN_LENGTH } from '@eda/contracts/api/auth';

export const SETTINGS_TABS = [
  'profile',
  'security',
  'sessions',
  'appearance',
  'ai',
  'notifications',
  'org',
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Sol menü grupları (sıra = görünüm sırası). */
export const SETTINGS_GROUPS: readonly {
  key: 'account' | 'preferences' | 'workspace';
  tabs: readonly SettingsTab[];
}[] = [
  { key: 'account', tabs: ['profile', 'security', 'sessions'] },
  { key: 'preferences', tabs: ['appearance', 'ai', 'notifications'] },
  { key: 'workspace', tabs: ['org'] },
];

/** Adres çubuğundaki `?bolum=` değeri (Türkçe, kalıcı bağlantı) ↔ bölüm. */
export const SECTION_SLUGS: Readonly<Record<SettingsTab, string>> = {
  profile: 'profil',
  security: 'guvenlik',
  sessions: 'oturumlar',
  appearance: 'gorunum',
  ai: 'yapay-zeka',
  notifications: 'bildirimler',
  org: 'buro',
};

export function tabOfSlug(slug: string | null): SettingsTab {
  const hit = (Object.entries(SECTION_SLUGS) as [SettingsTab, string][]).find(
    ([, v]) => v === slug,
  );
  return hit?.[0] ?? 'profile';
}

/** Avatar baş harfleri: ilk ve son sözcüğün ilk harfi (Türkçe büyük harf). */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + last).toLocaleUpperCase('tr-TR');
}

export { PASSWORD_MIN_LENGTH };

export interface ProfessionInfo {
  readonly baro: string;
  readonly sicilNo: string | null;
  readonly traineeRegistryNo: string | null;
}

export interface OrgInfo {
  readonly name: string;
  readonly kind: string;
  readonly role: string;
}

export interface SettingsModel {
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly verificationStatus: string;
  readonly profession: ProfessionInfo | null;
  readonly org: OrgInfo | null;
  readonly twoFactorEnabled: boolean;
  readonly hasPasskey: boolean;
  readonly mfaRequired: boolean;
  readonly stepUpValidUntil: string | null;
}

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNullableString = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v : null;

/**
 * `/api/v1/me` gövdesi (`MeDto`). Ekran çözümleme hatasıyla çizilemez; bu yüzden eksik veya
 * beklenmeyen alanlar güvenli varsayılana düşer, işlev hata atmaz.
 */
export function settingsModelOf(payload: unknown): SettingsModel {
  const me = asRecord(payload);
  const user = asRecord(me.user);
  const session = asRecord(me.session);
  const profile = me.profile === null || me.profile === undefined ? null : asRecord(me.profile);
  const org = me.activeOrg === null || me.activeOrg === undefined ? null : asRecord(me.activeOrg);
  const mfa = org === null ? null : asRecord(org.mfa);
  return {
    name: asString(user.name),
    email: asString(user.email),
    emailVerified: user.emailVerified === true,
    verificationStatus: asString(user.verificationStatus),
    profession:
      profile === null
        ? null
        : {
            baro: asString(profile.baro),
            sicilNo: asNullableString(profile.sicilNo),
            traineeRegistryNo: asNullableString(profile.traineeRegistryNo),
          },
    org:
      org === null
        ? null
        : {
            name: asString(org.name),
            kind: asString(org.kind),
            role: asString(org.role),
          },
    twoFactorEnabled: user.twoFactorEnabled === true,
    hasPasskey: user.hasPasskey === true,
    mfaRequired: mfa !== null && mfa.required === true,
    stepUpValidUntil: asNullableString(session.stepUpValidUntil),
  };
}

/** Oturum yoksa gövde kimlik alanlarını taşımaz: ekran "giriş gerekli" durumuna düşer. */
export function hasAccount(model: SettingsModel): boolean {
  return model.email !== '' || model.name !== '';
}

export type PasswordIssue = 'too_short' | 'mismatch';

/** Yerel ön denetim; sunucu kuralı esastır (Better Auth). */
export function passwordIssue(newPassword: string, confirmation: string): PasswordIssue | null {
  if (newPassword.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (newPassword !== confirmation) return 'mismatch';
  return null;
}

/** İki adımlı doğrulama / step-up gerektiren yanıt kodları (042 §6). */
export const STEP_UP_CODES: readonly string[] = [
  'AUTH_MFA_REQUIRED',
  'AUTH_STEP_UP_REQUIRED',
  'SESSION_NOT_FRESH',
];

/** Step-up yönlendirmesi: doğrulama ekranı, sonra buraya dönüş (042 §6.1). */
export function stepUpHref(here: string): string {
  return `/iki-adimli?sonraki=${encodeURIComponent(here)}`;
} /** Doğrulama durumu rozeti: metin anahtarı (bulunamayan durumda ayrıntı çizilmez). */
export type VerificationKey =
  | 'profile.verification.verified'
  | 'profile.verification.pending_verification'
  | 'profile.verification.rejected'
  | 'profile.verification.suspended';

export function verificationKey(status: string): VerificationKey | null {
  switch (status) {
    case 'verified':
      return 'profile.verification.verified';
    case 'pending_verification':
      return 'profile.verification.pending_verification';
    case 'rejected':
      return 'profile.verification.rejected';
    case 'suspended':
      return 'profile.verification.suspended';
    default:
      return null;
  }
}

export type OrgKindKey = 'org.kinds.individual' | 'org.kinds.firm';

export function orgKindKey(kind: string): OrgKindKey | null {
  if (kind === 'individual') return 'org.kinds.individual';
  if (kind === 'firm') return 'org.kinds.firm';
  return null;
}

export type RoleKey =
  | 'org.roles.owner'
  | 'org.roles.admin'
  | 'org.roles.senior_lawyer'
  | 'org.roles.lawyer'
  | 'org.roles.trainee'
  | 'org.roles.assistant';

export function roleKey(role: string): RoleKey | null {
  switch (role) {
    case 'owner':
      return 'org.roles.owner';
    case 'admin':
      return 'org.roles.admin';
    case 'senior_lawyer':
      return 'org.roles.senior_lawyer';
    case 'lawyer':
      return 'org.roles.lawyer';
    case 'trainee':
      return 'org.roles.trainee';
    case 'assistant':
      return 'org.roles.assistant';
    default:
      return null;
  }
}
