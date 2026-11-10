// `GET /api/v1/me` yanıtı ve bağlı DTO'lar (041 §2.1 birebir; 053-ekranlar/01 §9). İstemci
// sınırları derleme zamanı ortam değişkeni yerine buradan okunur (`limits`, `environment`).
import { z } from 'zod';
import { EDA_ENVS } from '../config/env.ts';
import {
  AI_DATA_RESIDENCIES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  MFA_LEVELS,
  ORG_KINDS,
  PLATFORM_ROLES,
  SENSITIVE_CASE_POLICIES,
  SUBSCRIPTION_STATUSES,
  VERIFICATION_STATUSES,
} from '../enums.ts';
import { LawyerProfileDto } from './auth.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

export const MembershipDto = z.strictObject({
  orgId: z.uuid(),
  orgName: z.string(),
  orgKind: z.enum(ORG_KINDS),
  role: z.enum(MEMBER_ROLES),
  status: z.enum(MEMBER_STATUSES),
});
export type MembershipDto = z.infer<typeof MembershipDto>;

export const LetterheadDto = z.strictObject({
  firmName: z.string(),
  lines: z.array(z.string()),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
});
export type LetterheadDto = z.infer<typeof LetterheadDto>;

export const OrgSettingsDto = z.strictObject({
  aiDataResidency: z.enum(AI_DATA_RESIDENCIES),
  sensitiveCasePolicy: z.enum(SENSITIVE_CASE_POLICIES),
  allowPublicMode: z.boolean(),
  showReasoning: z.boolean(),
  feedbackSharingEnabled: z.boolean(),
  mfaRequiredAll: z.boolean(),
  maskOwnCaseNumber: z.boolean(),
  assistantAiChatEnabled: z.boolean(),
  traineeSupervision: z.boolean(),
  traineeExportRequiresApproval: z.boolean(),
  retentionYearsAfterMandate: z.number().int(),
  reminderShortNameEnabled: z.boolean(),
  icsEnabled: z.boolean(),
  legalHold: z.boolean(),
  letterhead: LetterheadDto.nullable(),
});
export type OrgSettingsDto = z.infer<typeof OrgSettingsDto>;

export const MFA_REQUIRED_REASONS = [
  'mfa_required_role',
  'mfa_required_org',
  'mfa_required_client_data',
] as const;

export const MeDto = z.strictObject({
  user: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    platformRole: z.enum(PLATFORM_ROLES),
    verificationStatus: z.enum(VERIFICATION_STATUSES),
    twoFactorEnabled: z.boolean(),
    hasPasskey: z.boolean(),
  }),
  session: z.strictObject({
    id: z.uuid(),
    mfaLevel: z.enum(MFA_LEVELS),
    stepUpAt: IsoDateTime.nullable(),
    stepUpValidUntil: IsoDateTime.nullable(),
    createdAt: IsoDateTime,
    absoluteExpiresAt: IsoDateTime,
  }),
  profile: LawyerProfileDto.nullable(),
  memberships: z.array(MembershipDto),
  activeOrg: z
    .strictObject({
      id: z.uuid(),
      name: z.string(),
      kind: z.enum(ORG_KINDS),
      role: z.enum(MEMBER_ROLES),
      settings: OrgSettingsDto,
      subscription: z.strictObject({
        planCode: z.string(),
        status: z.enum(SUBSCRIPTION_STATUSES),
        trialEndsAt: IsoDateTime.nullable(),
        seats: z.number().int(),
      }),
      credits: z.strictObject({ balance: z.number().int() }),
      mfa: z.strictObject({
        required: z.boolean(),
        reason: z.enum(MFA_REQUIRED_REASONS).nullable(),
      }),
    })
    .nullable(),
  features: z.record(z.string(), z.boolean()),
  limits: z.strictObject({
    uploadMaxMb: z.number(),
    uploadAllowedTypes: z.array(z.string()),
    uploadMaxPagesPerFile: z.number(),
    uploadMaxFilesPerCase: z.number(),
    maxUserMessageChars: z.number(),
    maxAttachmentsPerMessage: z.number(),
    maxMentionsPerMessage: z.number(),
    pageSizeDefault: z.number(),
    pageSizeMax: z.number(),
    kvkkPreviewDebounceMs: z.number(),
    editorAutosaveDebounceMs: z.number(),
    editorAutosaveMaxWaitMs: z.number(),
    chatPollIntervalMs: z.number(),
    reminderDefaultMinutes: z.array(z.number()),
  }),
  environment: z.strictObject({
    kind: z.enum(EDA_ENVS),
    simulation: z.boolean(),
    rerankEnabled: z.boolean(),
    maintenance: z.boolean(),
  }),
});
export type MeDto = z.infer<typeof MeDto>;

/** Step-up yöntemleri (042 §6.1). Kabul edilen yöntem kullanıcının MFA durumuna göre seçilir. */
export const STEP_UP_METHODS = ['password', 'totp', 'passkey'] as const;
export type StepUpMethod = (typeof STEP_UP_METHODS)[number];

/**
 * `POST /api/v1/me/step-up` gövdesi (042 §6.1). Passkey kanıtı WebAuthn kimlik doğrulama yanıtıdır
 * (`passkey/generate-authenticate-options` meydan okumasıyla, oturumlu); doğrulama oturum yaratmaz.
 */
export const StepUpInput = z.discriminatedUnion('method', [
  z.strictObject({ method: z.literal('password'), password: z.string().min(1).max(128) }),
  z.strictObject({ method: z.literal('totp'), code: z.string().regex(/^[0-9]{6}$/) }),
  z.strictObject({
    method: z.literal('passkey'),
    response: z.record(z.string(), z.unknown()),
  }),
]);
export type StepUpInput = z.infer<typeof StepUpInput>;

export const StepUpResultDto = z.strictObject({
  stepUpAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type StepUpResultDto = z.infer<typeof StepUpResultDto>;

// --- Oturumlar (`GET /api/v1/me/sessions`; P23) ------------------------------------------------
// Better Auth `list-sessions` oturum BELİRTEÇLERİNİ döndürdüğü için tarayıcıya açılmaz; bu uç yalnız
// kimlik, zaman ve kısaltılmış ağ bilgisini verir. İptal kimlikle yapılır (belirteç sunucuda kalır).

export const SessionDeviceDto = z.strictObject({
  id: z.uuid(),
  current: z.boolean(),
  createdAt: IsoDateTime,
  lastActiveAt: IsoDateTime,
  expiresAt: IsoDateTime,
  /** Kısaltılmış IP (/24 veya /64); yoksa `null`. */
  ipTrunc: z.string().max(64).nullable(),
  /** Tarayıcı kimliği (en çok 300 karakter); cihaz etiketi istemcide türetilir. */
  userAgent: z.string().max(300).nullable(),
});
export type SessionDeviceDtoValue = z.infer<typeof SessionDeviceDto>;

export const SessionListResponse = z.strictObject({ items: z.array(SessionDeviceDto) });
export type SessionListResponseValue = z.infer<typeof SessionListResponse>;

export const RevokeSessionsResult = z.strictObject({ revoked: z.number().int().min(0) });
export type RevokeSessionsResultValue = z.infer<typeof RevokeSessionsResult>;
