// Kayıt ve meslek başvurusu sözleşmeleri (042 §3.1; 041 §3.3; 053-ekranlar/01 §5.2; 002 §26 madde 88).
// Kayıt adım 1 (`POST /api/auth/sign-up/email`) yalnız ad, e-posta, parola ve iki ayrı onay taşır;
// meslek bilgisi ve beyan e-posta doğrulamasından sonra `POST /api/v1/me/lawyer-application` ile gelir.
// Baro adı kümesi `@eda/legal` `BARO_NAMES`'tir (contracts legal'e bağımlı olamaz); api bu alanı ayrıca
// o kümeyle doğrular.
import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../config/defaults.ts';
import { VERIFICATION_STATUSES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

/** E-posta: yazdırılabilir ASCII (030 `users_email_chk`; 053-01 §5.2), en çok 254 karakter. */
export const EMAIL_ASCII_RE = /^[\x21-\x7E]+$/;
export const EMAIL_MAX_LENGTH = 254;
export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 100;
/** Baro / stajyer sicil numarası (030 `lawyer_profiles` CHECK). */
export const REGISTRY_NO_RE = /^[0-9A-Za-z/-]{1,20}$/;
/** Bayi/referans kodu (030 `partners_code_chk`). */
export const PARTNER_CODE_RE = /^[A-Z0-9-]{4,32}$/;
export const BARO_NAME_MAX_LENGTH = 100;

export const PASSWORD_MIN_LENGTH = CONFIG_DEFAULTS['auth.passwordMinLength'];
export const PASSWORD_MAX_LENGTH = CONFIG_DEFAULTS['auth.passwordMaxLength'];

export const EmailInput = z
  .string()
  .trim()
  .min(3)
  .max(EMAIL_MAX_LENGTH)
  .regex(EMAIL_ASCII_RE)
  .pipe(z.email());

export const PasswordInput = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/**
 * Gömülü yaygın parola kökleri (042 §2.8;): Türkçe katlanmış (`tr_fold`) parolanın
 * harf dışı karakterleri atıldığında bu köklerden birine eşitse parola zayıftır (ör. "Parola2026!").
 * Kural tabanlı asgari küme; lisanslı bir sızıntı listesiyle değiştirilmesi sahip kararıdır. Dış
 * sızıntı servisi çağrılmaz.
 */
export const COMMON_PASSWORD_BASES = [
  'password',
  'parola',
  'sifre',
  'sifrem',
  'qwerty',
  'qwertyuiop',
  'asdfgh',
  'asdfghjkl',
  'letmein',
  'welcome',
  'iloveyou',
  'admin',
  'administrator',
  'test',
  'deneme',
  'merhaba',
  'edahukuk',
  'eda',
  'hukuk',
  'avukat',
  'baro',
] as const;

/**
 * Uygulama içi dönüş yolu: `/` ile başlar (`//` ve şema yok), yol karakterleri ve isteğe bağlı basit sorgu
 * (`?durum=basarili`). Web formları bu biçimi gönderir; dış adres ve `\` reddedilir.
 */
export const INTERNAL_CALLBACK_RE =
  /^\/(?!\/)[A-Za-z0-9/_-]*(\?[A-Za-z0-9_-]+=[A-Za-z0-9_-]+(&[A-Za-z0-9_-]+=[A-Za-z0-9_-]+)*)?$/;

/** Adım 1 gövdesi (Better Auth `sign-up/email`). `callbackURL` yalnız uygulama içi yol. */
export const RegisterStep1Schema = z.strictObject({
  name: z.string().trim().min(NAME_MIN_LENGTH).max(NAME_MAX_LENGTH),
  email: EmailInput,
  password: PasswordInput,
  acceptTerms: z.literal(true),
  acknowledgePrivacy: z.literal(true),
  callbackURL: z.string().regex(INTERNAL_CALLBACK_RE).max(200).optional(),
  /**
   * Davetle kayıt (042 §4.2 adım 1; P04b): davet kimliği. Kayıt kancası daveti doğrular (bekliyor,
   * süresi dolmamış, adres eşit); geçerliyse hesap `email_verified = true` açılır ve bireysel büro
   * açılmaz. Değer saklanmaz.
   */
  invitationToken: z.uuid().optional(),
});
export type RegisterStep1 = z.infer<typeof RegisterStep1Schema>;

export const LAWYER_APPLICATION_KINDS = ['lawyer', 'trainee'] as const;
export type LawyerApplicationKind = (typeof LAWYER_APPLICATION_KINDS)[number];

/** Adım 2 / yeniden başvuru gövdesi (041 §3.3 `LawyerApplicationInput` + 053-01 beyan onayı). */
export const LawyerApplicationSchema = z
  .strictObject({
    kind: z.enum(LAWYER_APPLICATION_KINDS),
    baro: z.string().trim().min(1).max(BARO_NAME_MAX_LENGTH),
    sicilNo: z.string().regex(REGISTRY_NO_RE).optional(),
    traineeRegistryNo: z.string().regex(REGISTRY_NO_RE).optional(),
    partnerCode: z.string().regex(PARTNER_CODE_RE).optional(),
    declareProfession: z.literal(true),
    /**
     * Davet kabulünden önce meslek beyanı (042 §4.2 adım 4; P04b): kullanıcının e-postasına gelen,
     * meslek gerektiren roldeki bekleyen davetin kimliği. Profil `verification_source =
     * 'org_invitation'` ile işaretlenir; durum kabulde değişir.
     */
    invitationId: z.uuid().optional(),
  })
  .refine(
    (v) =>
      v.kind === 'lawyer'
        ? v.sicilNo !== undefined && v.traineeRegistryNo === undefined
        : v.traineeRegistryNo !== undefined && v.sicilNo === undefined,
    { path: ['sicilNo'], message: 'registry_mismatch' },
  );
export type LawyerApplicationInput = z.infer<typeof LawyerApplicationSchema>;

export const LawyerProfileDto = z.strictObject({
  baro: z.string(),
  sicilNo: z.string().nullable(),
  traineeRegistryNo: z.string().nullable(),
  verificationSource: z.enum(['admin_review', 'org_invitation']).nullable(),
  submittedAt: IsoDateTime,
  reviewedAt: IsoDateTime.nullable(),
  /** Ret neden kodu (`AdminApplicationRejectInput.reasonCode`); serbest metin değil. */
  rejectionReason: z.string().nullable(),
});
export type LawyerProfileDto = z.infer<typeof LawyerProfileDto>;

export const LawyerApplicationResultDto = z.strictObject({
  profile: LawyerProfileDto,
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  partnerCodeAccepted: z.boolean().nullable(),
});
export type LawyerApplicationResultDto = z.infer<typeof LawyerApplicationResultDto>;
