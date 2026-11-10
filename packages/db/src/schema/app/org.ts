// `app` kimlik ek tabloları, büro ve bayi (030 §4) + `user_preferences` (053-ekranlar/08 §3.3).
// RLS ve yetkiler el yazımı `rls` migrasyonundadır (031 §6.3; Drizzle'da pgPolicy YOK).

import { AI_KEY_SOURCES } from '@eda/contracts/api/ai-keys';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  AI_DATA_RESIDENCIES,
  MEMBER_STATUSES,
  ORG_KEY_STATUSES,
  PARTNER_MEMBER_ROLES,
  PARTNER_ORG_SOURCES,
  SENSITIVE_CASE_POLICIES,
  VERIFICATION_SOURCES,
} from '@eda/contracts/enums';
import { MODEL_ALIASES } from '@eda/contracts/stream';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { col, createdAt, idV7, tstz, updatedAt } from '../_columns.ts';
import { bytea } from '../_types.ts';
import { organizations, users } from '../auth.ts';
import { appSchema, partners } from './partners.ts';

const USER_INSTRUCTIONS_MAX = CONFIG_DEFAULTS['prompt.userInstructionsMaxChars'];
const ORG_INSTRUCTIONS_MAX = CONFIG_DEFAULTS['prompt.orgInstructionsMaxChars'];
const MIN_RETENTION_YEARS = CONFIG_DEFAULTS['retention.caseAfterMandateYears'];
const REGISTRY_NO = '^[0-9A-Za-z/-]{1,20}$';

/** Avukat/stajyer meslek bilgisi (RLS E, kullanıcı kapsamlı; `org_id` yok). */
export const lawyerProfiles = appSchema.table(
  'lawyer_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    baro: text('baro').notNull(),
    sicilNo: text('sicil_no'),
    traineeRegistryNo: text('trainee_registry_no'),
    verificationSource: text('verification_source'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: tstz('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    submittedAt: tstz('submitted_at').notNull().defaultNow(),
    aiInstructions: text('ai_instructions'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('lawyer_profiles_sicil_no_chk', sql`${col('sicil_no')} ~ ${sql.raw(`'${REGISTRY_NO}'`)}`),
    check(
      'lawyer_profiles_trainee_registry_no_chk',
      sql`${col('trainee_registry_no')} ~ ${sql.raw(`'${REGISTRY_NO}'`)}`,
    ),
    inList('lawyer_profiles', t.verificationSource, VERIFICATION_SOURCES),
    check(
      'lawyer_profiles_ai_instructions_chk',
      sql`char_length(${col('ai_instructions')}) <= ${sql.raw(String(USER_INSTRUCTIONS_MAX))}`,
    ),
    check(
      'lawyer_profiles_one_registry_chk',
      sql`(${col('sicil_no')} IS NULL) <> (${col('trainee_registry_no')} IS NULL)`,
    ),
    unique('lawyer_profiles_baro_sicil_uq').on(t.baro, t.sicilNo),
    unique('lawyer_profiles_baro_trainee_uq').on(t.baro, t.traineeRegistryNo),
    index('lawyer_profiles_reviewed_by_idx')
      .on(t.reviewedBy)
      .where(sql`${col('reviewed_by')} IS NOT NULL`),
  ],
);

/** Büro ayarları (RLS E; 002 §7 büro düzeyi değerleri). */
export const orgSettings = appSchema.table(
  'org_settings',
  {
    orgId: uuid('org_id')
      .primaryKey()
      .references(() => organizations.id),
    aiDataResidency: text('ai_data_residency').notNull().default('eu_or_tr'),
    sensitiveCasePolicy: text('sensitive_case_policy').notNull().default('tr_only'),
    allowPublicMode: boolean('allow_public_mode').notNull().default(false),
    showReasoning: boolean('show_reasoning').notNull().default(false),
    feedbackSharingEnabled: boolean('feedback_sharing_enabled').notNull().default(true),
    mfaRequiredAll: boolean('mfa_required_all').notNull().default(false),
    maskOwnCaseNumber: boolean('mask_own_case_number').notNull().default(true),
    assistantAiChatEnabled: boolean('assistant_ai_chat_enabled').notNull().default(false),
    traineeSupervision: boolean('trainee_supervision').notNull().default(false),
    traineeExportRequiresApproval: boolean('trainee_export_requires_approval')
      .notNull()
      .default(false),
    retentionYearsAfterMandate: integer('retention_years_after_mandate')
      .notNull()
      .default(MIN_RETENTION_YEARS),
    reminderShortNameEnabled: boolean('reminder_short_name_enabled').notNull().default(false),
    icsEnabled: boolean('ics_enabled').notNull().default(false),
    legalHold: boolean('legal_hold').notNull().default(false),
    letterhead: jsonb('letterhead'),
    aiInstructions: text('ai_instructions'),
    // Büro/baro Claude API anahtarı (#54 BYOK): org DEK ile şifreli; yanıtlarda yalnız son 4 karakter.
    aiApiKeyEnc: bytea('ai_api_key_enc'),
    aiApiKeyLast4: text('ai_api_key_last4'),
    aiApiKeyVersion: integer('ai_api_key_version'),
    aiApiKeyVerifiedAt: tstz('ai_api_key_verified_at'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('org_settings', t.aiDataResidency, AI_DATA_RESIDENCIES),
    inList('org_settings', t.sensitiveCasePolicy, SENSITIVE_CASE_POLICIES),
    check(
      'org_settings_retention_years_after_mandate_chk',
      sql`${col('retention_years_after_mandate')} >= ${sql.raw(String(MIN_RETENTION_YEARS))}`,
    ),
    check(
      'org_settings_ai_instructions_chk',
      sql`char_length(${col('ai_instructions')}) <= ${sql.raw(String(ORG_INSTRUCTIONS_MAX))}`,
    ),
    check(
      'org_settings_ai_api_key_chk',
      sql`(${col('ai_api_key_enc')} IS NULL) = (${col('ai_api_key_last4')} IS NULL) AND (${col('ai_api_key_enc')} IS NULL) = (${col('ai_api_key_version')} IS NULL)`,
    ),
    index('org_settings_updated_by_idx')
      .on(t.updatedBy)
      .where(sql`${col('updated_by')} IS NOT NULL`),
  ],
);

/** Büro DEK'leri (RLS E; KEK ile sarılı; 033 §5). */
export const orgKeys = appSchema.table(
  'org_keys',
  {
    id: idV7(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    keyVersion: integer('key_version').notNull(),
    wrappedDek: bytea('wrapped_dek'),
    kekVersion: integer('kek_version').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    retiredAt: tstz('retired_at'),
    shreddedAt: tstz('shredded_at'),
  },
  (t) => [
    check('org_keys_key_version_chk', sql`${col('key_version')} >= 1`),
    inList('org_keys', t.status, ORG_KEY_STATUSES),
    unique('org_keys_org_id_uq').on(t.orgId, t.id),
    unique('org_keys_version_uq').on(t.orgId, t.keyVersion),
    check(
      'org_keys_shred_chk',
      sql`(${col('status')} IN (${sqlValueList(['retired', 'shredded'])})) = (${col('wrapped_dek')} IS NULL)`,
    ),
    uniqueIndex('org_keys_one_active_uq')
      .on(t.orgId)
      .where(sql`${col('status')} IN (${sqlValueList(['active'])})`),
  ],
);

/** Bayi kullanıcıları (V1.1; MVP'de boş; RLS —). */
export const partnerMembers = appSchema.table(
  'partner_members',
  {
    id: idV7(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('partner_members_user_id_uq').on(t.userId),
    inList('partner_members', t.role, PARTNER_MEMBER_ROLES),
    inList('partner_members', t.status, MEMBER_STATUSES),
    index('partner_members_partner_idx').on(t.partnerId),
  ],
);

/** Bayi–büro bağı (V1.1; RLS —). */
export const partnerOrganizations = appSchema.table(
  'partner_organizations',
  {
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    source: text('source').notNull().default('partner_code'),
    linkedAt: tstz('linked_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: 'partner_organizations_pkey', columns: [t.partnerId, t.orgId] }),
    unique('partner_organizations_org_id_uq').on(t.orgId),
    inList('partner_organizations', t.source, PARTNER_ORG_SOURCES),
  ],
);

/** Kullanıcı tercihleri (RLS E, kullanıcı kapsamlı; `withUserScope`). */
export const userPreferences = appSchema.table(
  'user_preferences',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    termsVersion: text('terms_version'),
    termsAcceptedAt: tstz('terms_accepted_at'),
    privacyNoticeVersion: text('privacy_notice_version'),
    privacyNoticeAckAt: tstz('privacy_notice_ack_at'),
    signatureBlock: jsonb('signature_block'),
    defaultAlias: text('default_alias').notNull().default('edai-flash'),
    // Sohbette kullanılacak Claude anahtarı: büro/baro (`org`) veya kullanıcının kendisi (`own`).
    aiKeySource: text('ai_key_source').notNull().default('org'),
    // Kendi anahtarı: KEK'ten türetilen kullanıcı anahtarıyla şifreli (`ai_api_key_version` = KEK sürümü).
    aiApiKeyEnc: bytea('ai_api_key_enc'),
    aiApiKeyLast4: text('ai_api_key_last4'),
    aiApiKeyVersion: integer('ai_api_key_version'),
    aiApiKeyVerifiedAt: tstz('ai_api_key_verified_at'),
    onboarding: jsonb('onboarding')
      .notNull()
      .default(sql`'{"tourCompleted":false,"dismissedAt":null}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('user_preferences', t.defaultAlias, MODEL_ALIASES),
    inList('user_preferences', t.aiKeySource, AI_KEY_SOURCES),
    check(
      'user_preferences_ai_api_key_chk',
      sql`(${col('ai_api_key_enc')} IS NULL) = (${col('ai_api_key_last4')} IS NULL) AND (${col('ai_api_key_enc')} IS NULL) = (${col('ai_api_key_version')} IS NULL)`,
    ),
  ],
);

export type LawyerProfile = typeof lawyerProfiles.$inferSelect;
export type OrgSettings = typeof orgSettings.$inferSelect;
export type OrgKey = typeof orgKeys.$inferSelect;
export type PartnerMember = typeof partnerMembers.$inferSelect;
export type PartnerOrganization = typeof partnerOrganizations.$inferSelect;
export type UserPreferences = typeof userPreferences.$inferSelect;
