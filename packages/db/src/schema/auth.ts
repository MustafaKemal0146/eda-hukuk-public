// `auth` şeması (030 §3; Better Auth 1.7, `usePlural: true`, `generateId: false`). RLS YOK; yalnız
// eda_auth DML, eda_app kolon kısıtlı SELECT (031 §3; 0003_rls_auth_column_grants.sql).
// Kaynak: `auth generate` (CLI 1.7.7) çıktısı 030 §3.1 eşlemesiyle elle düzeltildi:
// snake_case kolon adları açık, kimlikler uuid + uuidv7() (davet kimliği v4), zamanlar timestamptz,
// enum kolonları inList() CHECK'leri. Kolon harmanlaması (users.name, organizations.name)
// Drizzle'da ifade edilemez; 0002_schema_auth.sql içinde `-- eda:patched` ile eklenir (030 §1.9).
import {
  INVITATION_STATUSES,
  MEMBER_ROLES,
  MEMBER_STATUSES,
  MFA_LEVELS,
  ORG_KINDS,
  PLATFORM_ROLES,
  RECOVERY_APPROVAL_PATHS,
  RECOVERY_EVIDENCE_CODES,
  RECOVERY_KINDS,
  RECOVERY_STATUSES,
  type RecoveryStatus,
  SESSION_SURFACES,
  VERIFICATION_STATUSES,
} from '@eda/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  inet,
  integer,
  pgSchema,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from './_checks.ts';
import { bytea } from './_types.ts';
import { partners } from './app/partners.ts';

export const authSchema = pgSchema('auth');

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const idV7 = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const createdAt = () => tstz('created_at').notNull().defaultNow();
const updatedAt = () => tstz('updated_at').notNull().defaultNow();

/** Davetle verilebilecek roller: `owner` davetle atanmaz (030 §3.2). */
const INVITATION_ROLES = MEMBER_ROLES.filter((r) => r !== 'owner');
/** Açık kurtarma talebi durumları (`recovery_open_uq`, 042 §12.2). */
const OPEN_RECOVERY_STATUSES: readonly RecoveryStatus[] = ['awaiting_approval', 'waiting', 'ready'];

export const users = authSchema.table(
  'users',
  {
    id: idV7(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
    platformRole: text('platform_role').notNull().default('user'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: tstz('ban_expires_at'),
    verificationStatus: text('verification_status').notNull().default('pending_verification'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('users', t.platformRole, PLATFORM_ROLES),
    inList('users', t.verificationStatus, VERIFICATION_STATUSES),
    // lower(email) benzersizliği: CHECK (email = lower(email)) + UNIQUE (email); ASCII dışı e-posta reddedilir.
    check('users_email_chk', sql.raw(String.raw`email = lower(email) AND email !~ '[^\x21-\x7E]'`)),
    unique('users_email_uq').on(t.email),
  ],
);

export const organizations = authSchema.table(
  'organizations',
  {
    id: idV7(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    logo: text('logo'),
    metadata: text('metadata'),
    kind: text('kind').notNull().default('individual'),
    partnerCode: text('partner_code').references(() => partners.code, { onUpdate: 'cascade' }),
    suspendedAt: tstz('suspended_at'),
    closedAt: tstz('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('organizations', t.kind, ORG_KINDS),
    unique('organizations_slug_uq').on(t.slug),
    index('organizations_partner_code_idx')
      .on(t.partnerCode)
      .where(sql`${sql.identifier('partner_code')} IS NOT NULL`),
  ],
);

export const sessions = authSchema.table(
  'sessions',
  {
    id: idV7(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    activeOrganizationId: uuid('active_organization_id').references(() => organizations.id, {
      onDelete: 'set null',
    }),
    impersonatedBy: uuid('impersonated_by'),
    mfaLevel: text('mfa_level').notNull().default('none'),
    stepUpAt: tstz('step_up_at'),
    surface: text('surface').notNull().default('app'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('sessions_token_uq').on(t.token),
    // Impersonation kapalı (042 §2.3): kolon yalnız Better Auth uyumu için vardır.
    check('sessions_impersonated_by_chk', sql`${sql.identifier('impersonated_by')} IS NULL`),
    inList('sessions', t.mfaLevel, MFA_LEVELS),
    inList('sessions', t.surface, SESSION_SURFACES),
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
    // FK öncü kolon indeksi (KK-030-17; P03b, 0021_index_auth_fk_columns).
    index('sessions_active_org_idx')
      .on(t.activeOrganizationId)
      .where(sql`${sql.identifier('active_organization_id')} IS NOT NULL`),
  ],
);

export const accounts = authSchema.table(
  'accounts',
  {
    id: idV7(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: tstz('access_token_expires_at'),
    refreshTokenExpiresAt: tstz('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Parola yalnız Argon2id PHC dizesi (030 §3.2; özel hash P04).
    check(
      'accounts_password_chk',
      sql`${sql.identifier('password')} IS NULL OR ${sql.identifier('password')} LIKE '$argon2id$%'`,
    ),
    unique('accounts_provider_account_uq').on(t.providerId, t.accountId),
    index('accounts_user_id_idx').on(t.userId),
  ],
);

export const verifications = authSchema.table(
  'verifications',
  {
    id: idV7(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('verifications_identifier_idx').on(t.identifier),
    index('verifications_expires_at_idx').on(t.expiresAt),
  ],
);

export const twoFactors = authSchema.table(
  'two_factors',
  {
    id: idV7(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    // Better Auth 1.7 twoFactor alanları (030 §3.2'de yok).
    verified: boolean('verified').notNull().default(true),
    failedVerificationCount: integer('failed_verification_count').notNull().default(0),
    lockedUntil: tstz('locked_until'),
    createdAt: createdAt(),
  },
  (t) => [unique('two_factors_user_id_uq').on(t.userId)],
);

export const passkeys = authSchema.table(
  'passkeys',
  {
    id: idV7(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    credentialID: text('credential_id').notNull(),
    counter: bigint('counter', { mode: 'number' }).notNull().default(0),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    aaguid: text('aaguid'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('passkeys_credential_id_uq').on(t.credentialID),
    index('passkeys_user_id_idx').on(t.userId),
  ],
);

export const members = authSchema.table(
  'members',
  {
    id: idV7(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('members', t.role, MEMBER_ROLES),
    inList('members', t.status, MEMBER_STATUSES),
    // case_members bileşik FK hedefi (030 §3.2).
    unique('members_org_user_uq').on(t.organizationId, t.userId),
    index('members_user_id_idx').on(t.userId),
  ],
);

export const invitations = authSchema.table(
  'invitations',
  {
    // URL taşıyıcı token'ı: zaman bileşeni sızdırmayan v4 (030 §1.2).
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('pending'),
    expiresAt: tstz('expires_at').notNull(),
    inviterId: uuid('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'invitations_email_chk',
      sql`${sql.identifier('email')} = lower(${sql.identifier('email')})`,
    ),
    inList('invitations', t.role, INVITATION_ROLES),
    inList('invitations', t.status, INVITATION_STATUSES),
    uniqueIndex('invitations_pending_uq')
      .on(t.organizationId, t.email)
      .where(sql`${sql.identifier('status')} IN (${sqlValueList(['pending'])})`),
    index('invitations_email_idx')
      .on(t.email)
      .where(sql`${sql.identifier('status')} IN (${sqlValueList(['pending'])})`),
    index('invitations_inviter_idx').on(t.inviterId),
  ],
);

/** MFA sıfırlama ve e-posta değişikliği talepleri (042 §12.2). */
export const accountRecoveryRequests = authSchema.table(
  'account_recovery_requests',
  {
    id: idV7(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    approvalPath: text('approval_path').notNull(),
    status: text('status').notNull().default('awaiting_approval'),
    newEmail: text('new_email'),
    approvedBy: uuid('approved_by').references(() => users.id),
    staffApprover1: uuid('staff_approver_1').references(() => users.id),
    staffApprover2: uuid('staff_approver_2').references(() => users.id),
    evidenceCode: text('evidence_code'),
    completeTokenHash: bytea('complete_token_hash'),
    cancelTokenHash: bytea('cancel_token_hash'),
    ipTrunc: inet('ip_trunc'),
    requestedAt: tstz('requested_at').notNull().defaultNow(),
    approvedAt: tstz('approved_at'),
    executableAt: tstz('executable_at'),
    expiresAt: tstz('expires_at').notNull(),
    completedAt: tstz('completed_at'),
  },
  (t) => [
    inList('account_recovery_requests', t.kind, RECOVERY_KINDS),
    inList('account_recovery_requests', t.approvalPath, RECOVERY_APPROVAL_PATHS),
    inList('account_recovery_requests', t.status, RECOVERY_STATUSES),
    inList('account_recovery_requests', t.evidenceCode, RECOVERY_EVIDENCE_CODES),
    check(
      'account_recovery_requests_new_email_chk',
      sql`${sql.identifier('new_email')} IS NULL OR ${sql.identifier('new_email')} = lower(${sql.identifier('new_email')})`,
    ),
    check(
      'account_recovery_requests_complete_token_hash_chk',
      sql`octet_length(${sql.identifier('complete_token_hash')}) = 32`,
    ),
    check(
      'account_recovery_requests_cancel_token_hash_chk',
      sql`octet_length(${sql.identifier('cancel_token_hash')}) = 32`,
    ),
    check(
      'recovery_staff_distinct_chk',
      sql`${sql.identifier('staff_approver_1')} IS NULL OR ${sql.identifier('staff_approver_2')} IS NULL OR ${sql.identifier('staff_approver_1')} <> ${sql.identifier('staff_approver_2')}`,
    ),
    check(
      'recovery_owner_not_self_chk',
      sql`${sql.identifier('approved_by')} IS NULL OR ${sql.identifier('approved_by')} <> ${sql.identifier('user_id')}`,
    ),
    check(
      'recovery_email_chk',
      sql`(${sql.identifier('kind')} = 'email_change') = (${sql.identifier('new_email')} IS NOT NULL)`,
    ),
    uniqueIndex('recovery_open_uq')
      .on(t.userId, t.kind)
      .where(sql`${sql.identifier('status')} IN (${sqlValueList(OPEN_RECOVERY_STATUSES)})`),
    index('recovery_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${sql.identifier('status')} IN (${sqlValueList(OPEN_RECOVERY_STATUSES)})`),
    index('recovery_approved_by_idx')
      .on(t.approvedBy)
      .where(sql`${sql.identifier('approved_by')} IS NOT NULL`),
    index('recovery_staff_approver_1_idx')
      .on(t.staffApprover1)
      .where(sql`${sql.identifier('staff_approver_1')} IS NOT NULL`),
    index('recovery_staff_approver_2_idx')
      .on(t.staffApprover2)
      .where(sql`${sql.identifier('staff_approver_2')} IS NOT NULL`),
  ],
);

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Invitation = typeof invitations.$inferSelect;
export type AccountRecoveryRequest = typeof accountRecoveryRequests.$inferSelect;
