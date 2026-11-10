// `app` platform, denetim, rollup (030 §12) + `email_deliveries` (045 §13.2). `audit_log` EKLİ ve
// aylık RANGE bölümlüdür; tek yazma yolu `app.audit_append()` (031 §8.1). Rollup tablolarında
// kullanıcı kırılımı ve içerik kolonu YOK (KK-031-10).
import { ORG_LIMIT_KEYS } from '@eda/contracts/api/admin-usage';
import { AUDIT_ACTIONS } from '@eda/contracts/audit-events';
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_SEVERITIES,
  AUDIT_ACTOR_TYPES,
  BREAKER_STATES,
  DELETION_REASONS,
  EMAIL_DELIVERY_STATUSES,
  KVKK_REJECTION_REASONS,
  KVKK_REQUEST_SCOPES,
  KVKK_REQUEST_STATUSES,
  KVKK_REQUEST_TYPES,
  NOTIFICATION_CLASSES,
  ORG_CLOSURE_BLOCKED_REASONS,
  ORG_CLOSURE_MODES,
  ORG_CLOSURE_PHASES,
  PRODUCT_EVENT_NAMES,
  PRODUCT_METRIC_CODES,
  SUPPORT_ACCESS_SCOPES,
  SUPPORT_TICKET_CATEGORIES,
  SUPPORT_TICKET_PRIORITIES,
  SUPPORT_TICKET_STATUSES,
} from '@eda/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  jsonb,
  primaryKey,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { col, createdAt, fk, idV7, idV7NoPk, tstz, updatedAt } from '../_columns.ts';
import { bytea, tstzrange } from '../_types.ts';
import { organizations, users } from '../auth.ts';
import { feedbackShares } from './chat.ts';
import { documentExports } from './document.ts';
import { appSchema } from './partners.ts';

const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const orgIdRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id);
const big = (name: string) => bigint(name, { mode: 'number' });

/** Denetim kaydı (içeriksiz; `org_id NULL` = platform zinciri; EKLİ; aylık bölüm; FK yok). */
export const auditLog = appSchema.table(
  'audit_log',
  {
    id: idV7NoPk(),
    orgId: uuid('org_id'),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    ipTrunc: inet('ip_trunc'),
    requestId: text('request_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'audit_log_pkey', columns: [t.id, t.createdAt] }),
    inList('audit_log', t.actorType, AUDIT_ACTOR_TYPES),
    inList('audit_log', t.action, AUDIT_ACTIONS),
    index('audit_log_org_idx').on(t.orgId, t.createdAt.desc()),
    index('audit_log_action_idx').on(t.orgId, t.action, t.createdAt.desc()),
    index('audit_log_brin').using('brin', t.createdAt),
  ],
);

/** Dakikalık Merkle/zincir mühürleri (RLS K; `eda_app` yalnız `app.org_audit_seals()` ile). */
export const auditSeals = appSchema.table(
  'audit_seals',
  {
    id: idV7(),
    chainKey: text('chain_key').notNull(),
    orgId: uuid('org_id'),
    periodStart: tstz('period_start').notNull(),
    periodEnd: tstz('period_end').notNull(),
    rowCount: integer('row_count').notNull(),
    firstRowId: uuid('first_row_id'),
    lastRowId: uuid('last_row_id'),
    merkleRoot: bytea('merkle_root').notNull(),
    prevSealHash: bytea('prev_seal_hash'),
    sealHash: bytea('seal_hash').notNull(),
    publishedObjectKey: text('published_object_key'),
    publishedAt: tstz('published_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('audit_seals_merkle_root_chk', sql`octet_length(${col('merkle_root')}) = 32`),
    check('audit_seals_seal_hash_chk', sql`octet_length(${col('seal_hash')}) = 32`),
    check(
      'audit_seals_chain_chk',
      sql`${col('chain_key')} = coalesce(${col('org_id')}::text, 'platform')`,
    ),
    unique('audit_seals_period_uq').on(t.chainKey, t.periodStart),
  ],
);

/** Silinen kök kayıt kimliği + zaman (geri yüklemeden sonra yeniden uygulanır; 035). */
export const deletionLog = appSchema.table(
  'deletion_log',
  {
    id: idV7(),
    tableName: text('table_name').notNull(),
    rowId: uuid('row_id').notNull(),
    orgId: uuid('org_id'),
    reason: text('reason').notNull().default('user_request'),
    deletedAt: tstz('deleted_at').notNull().defaultNow(),
    exportedAt: tstz('exported_at'),
  },
  (t) => [
    inList('deletion_log', t.reason, DELETION_REASONS),
    unique('deletion_log_row_uq').on(t.tableName, t.rowId),
    index('deletion_log_unexported_idx')
      .on(t.deletedAt)
      .where(sql`${col('exported_at')} IS NULL`),
    index('deletion_log_deleted_at_idx').on(t.deletedAt),
  ],
);

/** Platform duyuruları (düz metin). */
export const announcements = appSchema.table(
  'announcements',
  {
    id: idV7(),
    severity: text('severity').notNull(),
    audience: text('audience').notNull().default('all'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    activeDuring: tstzrange('active_during').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('announcements', t.severity, ANNOUNCEMENT_SEVERITIES),
    inList('announcements', t.audience, ANNOUNCEMENT_AUDIENCES),
    index('announcements_active_idx').using('gist', t.activeDuring),
    index('announcements_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Özellik bayrakları (MVP'de küresel; `maintenance_mode` dahil). */
export const featureFlags = appSchema.table(
  'feature_flags',
  {
    key: text('key').primaryKey(),
    enabled: boolean('enabled').notNull().default(false),
    description: text('description'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('feature_flags_key_chk', sql`${col('key')} ~ '^[a-z0-9_.]{2,64}$'`),
    index('feature_flags_updated_by_idx').on(t.updatedBy).where(notNull('updated_by')),
  ],
);

/** Admin ayarlanabilir yapılandırma değerleri (yalnız 002 §7 "Admin = E" anahtarları). */
export const systemSettings = appSchema.table(
  'system_settings',
  {
    key: text('key').primaryKey(),
    value: jsonb('value').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('system_settings_key_chk', sql`${col('key')} ~ '^[a-z]+\\.[a-zA-Z0-9.]+$'`),
    index('system_settings_updated_by_idx').on(t.updatedBy).where(notNull('updated_by')),
  ],
);

/**
 * Büro bazlı limit geçersiz kılma (yalnız `ORG_LIMIT_KEYS`; yazma yalnız `app.admin_org_limit_set/clear`
 * fonksiyonlarıyla, `eda_app` yalnız okur). Satır yoksa platform varsayılanı (ayar zinciri) geçerlidir.
 */
export const orgLimitOverrides = appSchema.table(
  'org_limit_overrides',
  {
    orgId: orgIdRef(),
    key: text('key').notNull(),
    value: big('value').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'org_limit_overrides_pkey', columns: [t.orgId, t.key] }),
    inList('org_limit_overrides', t.key, ORG_LIMIT_KEYS),
    check('org_limit_overrides_value_chk', sql`${col('value')} >= 1`),
    index('org_limit_overrides_updated_by_idx').on(t.updatedBy).where(notNull('updated_by')),
  ],
);

/** Destek talepleri (yanıt zinciri MVP'de e-postayla). */
export const supportTickets = appSchema.table(
  'support_tickets',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    category: text('category').notNull().default('other'),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    priority: text('priority').notNull().default('normal'),
    status: text('status').notNull().default('open'),
    feedbackShareId: uuid('feedback_share_id').references(() => feedbackShares.id, {
      onDelete: 'set null',
    }),
    closedAt: tstz('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('support_tickets', t.category, SUPPORT_TICKET_CATEGORIES),
    inList('support_tickets', t.priority, SUPPORT_TICKET_PRIORITIES),
    inList('support_tickets', t.status, SUPPORT_TICKET_STATUSES),
    index('support_tickets_org_idx').on(t.orgId, t.status, t.createdAt.desc()),
    index('support_tickets_user_idx').on(t.userId).where(notNull('user_id')),
    index('support_tickets_feedback_share_idx')
      .on(t.feedbackShareId)
      .where(notNull('feedback_share_id')),
  ],
);

/** Büro kapanış aşamaları (035 §8.2; okuma owner). */
export const orgClosures = appSchema.table(
  'org_closures',
  {
    id: idV7(),
    orgId: orgIdRef(),
    phase: text('phase').notNull().default('return'),
    mode: text('mode').notNull().default('standard'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    requestedAt: tstz('requested_at').notNull().defaultNow(),
    returnUntil: tstz('return_until').notNull(),
    frozenAt: tstz('frozen_at'),
    deleteAfter: tstz('delete_after'),
    deletingStartedAt: tstz('deleting_started_at'),
    deletedAt: tstz('deleted_at'),
    cancelledAt: tstz('cancelled_at'),
    exportIds: uuid('export_ids').array().notNull().default(sql`'{}'::uuid[]`),
    exportVerifiedAt: tstz('export_verified_at'),
    returnConfirmedAt: tstz('return_confirmed_at'),
    blockedReason: text('blocked_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('org_closures', t.phase, ORG_CLOSURE_PHASES),
    inList('org_closures', t.mode, ORG_CLOSURE_MODES),
    inList('org_closures', t.blockedReason, ORG_CLOSURE_BLOCKED_REASONS),
    uniqueIndex('org_closures_one_active_uq')
      .on(t.orgId)
      .where(sql`${col('phase')} IN (${sqlValueList(['return', 'frozen', 'deleting'])})`),
    index('org_closures_org_idx').on(t.orgId, t.createdAt.desc()),
    index('org_closures_requested_by_idx').on(t.requestedBy).where(notNull('requested_by')),
  ],
);

/** İlgili kişi başvuruları (KVKK m.11, m.13; 035 §9). */
export const kvkkRequests = appSchema.table(
  'kvkk_requests',
  {
    id: idV7(),
    orgId: orgIdRef(),
    requesterUserId: uuid('requester_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    requestType: text('request_type').notNull(),
    status: text('status').notNull().default('received'),
    description: text('description'),
    dueAt: tstz('due_at').notNull(),
    exportId: uuid('export_id'),
    rejectionReason: text('rejection_reason'),
    scope: text('scope').notNull().default('org_data'),
    subjectRefHmac: bytea('subject_ref_hmac'),
    identityVerifiedAt: tstz('identity_verified_at'),
    decision: jsonb('decision'),
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    completedAt: tstz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('kvkk_requests', t.requestType, KVKK_REQUEST_TYPES),
    inList('kvkk_requests', t.status, KVKK_REQUEST_STATUSES),
    inList('kvkk_requests', t.rejectionReason, KVKK_REJECTION_REASONS),
    inList('kvkk_requests', t.scope, KVKK_REQUEST_SCOPES),
    check(
      'kvkk_requests_subject_ref_hmac_chk',
      sql`${col('subject_ref_hmac')} IS NULL OR octet_length(${col('subject_ref_hmac')}) = 32`,
    ),
    fk(
      'kvkk_requests_export_fk',
      [t.orgId, t.exportId],
      [documentExports.orgId, documentExports.id],
    ).onDelete('set null'),
    index('kvkk_requests_org_idx').on(t.orgId, t.status, t.dueAt),
    index('kvkk_requests_export_idx').on(t.orgId, t.exportId).where(notNull('export_id')),
    index('kvkk_requests_requester_idx').on(t.requesterUserId).where(notNull('requester_user_id')),
    index('kvkk_requests_handled_by_idx').on(t.handledBy).where(notNull('handled_by')),
  ],
);

/** İçeriksiz ürün metrikleri (ekli; FK yok). */
export const productEvents = appSchema.table(
  'product_events',
  {
    id: idV7(),
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id'),
    eventName: text('event_name').notNull(),
    props: jsonb('props').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    inList('product_events', t.eventName, PRODUCT_EVENT_NAMES),
    index('product_events_org_idx').on(t.orgId, t.eventName, t.createdAt),
    index('product_events_brin').using('brin', t.createdAt),
  ],
);

/** Break-glass izinleri (V1.1; MVP'de boş; politika MVP'de kurulur). */
export const supportAccessGrants = appSchema.table(
  'support_access_grants',
  {
    id: idV7(),
    orgId: orgIdRef(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    granteeUserId: uuid('grantee_user_id')
      .notNull()
      .references(() => users.id),
    scope: text('scope').notNull(),
    targetId: uuid('target_id').notNull(),
    reason: text('reason').notNull(),
    startsAt: tstz('starts_at').notNull(),
    expiresAt: tstz('expires_at').notNull(),
    usedAt: tstz('used_at'),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    inList('support_access_grants', t.scope, SUPPORT_ACCESS_SCOPES),
    check('support_access_grants_window_chk', sql`${col('expires_at')} > ${col('starts_at')}`),
    index('support_access_grants_idx').on(t.orgId, t.granteeUserId, t.expiresAt),
    index('support_access_grants_grantee_idx').on(t.granteeUserId),
    index('support_access_grants_granted_by_idx').on(t.grantedBy).where(notNull('granted_by')),
  ],
);

/** E-posta gönderim kuyruğu/günlüğü (içeriksiz; kullanıcıya SELECT yok; 045 §13.2). */
export const emailDeliveries = appSchema.table(
  'email_deliveries',
  {
    id: idV7(),
    orgId: uuid('org_id').references(() => organizations.id),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    invitationId: uuid('invitation_id'),
    kind: text('kind').notNull(),
    templateCode: text('template_code').notNull(),
    templateVersion: text('template_version').notNull(),
    class: text('class').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    sealedParams: bytea('sealed_params'),
    expiresAt: tstz('expires_at').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    providerMessageId: text('provider_message_id'),
    errorCode: text('error_code'),
    sentAt: tstz('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('email_deliveries', t.class, NOTIFICATION_CLASSES),
    unique('email_deliveries_dedupe_key_uq').on(t.dedupeKey),
    inList('email_deliveries', t.status, EMAIL_DELIVERY_STATUSES),
    check(
      'email_deliveries_recipient_chk',
      sql`${col('user_id')} IS NOT NULL OR ${col('invitation_id')} IS NOT NULL OR ${col('sealed_params')} IS NOT NULL OR ${col('status')} IN (${sqlValueList(['sent', 'failed', 'suppressed', 'expired', 'cancelled'])})`,
    ),
    index('email_deliveries_pending_idx')
      .on(t.createdAt)
      .where(sql`${col('status')} IN (${sqlValueList(['queued', 'sending'])})`),
    index('email_deliveries_user_idx').on(t.userId, t.createdAt.desc()).where(notNull('user_id')),
    index('email_deliveries_org_idx').on(t.orgId, t.createdAt.desc()).where(notNull('org_id')),
  ],
);

/** Gün × büro × takma ad × sağlayıcı × görev × sınıf kullanım agregatı (`usage.rollup`). */
export const adminRollupUsageDaily = appSchema.table(
  'admin_rollup_usage_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    orgId: uuid('org_id'),
    modelAlias: text('model_alias').notNull(),
    providerId: text('provider_id').notNull(),
    task: text('task').notNull(),
    dataClass: text('data_class').notNull(),
    calls: integer('calls').notNull(),
    inputTokens: big('input_tokens').notNull(),
    cachedInputTokens: big('cached_input_tokens').notNull(),
    outputTokens: big('output_tokens').notNull(),
    reasoningTokens: big('reasoning_tokens').notNull(),
    costMicroUsd: big('cost_micro_usd').notNull(),
    credits: big('credits').notNull(),
  },
  (t) => [
    unique('admin_rollup_usage_daily_uq')
      .on(t.day, t.orgId, t.modelAlias, t.providerId, t.task, t.dataClass)
      .nullsNotDistinct(),
  ],
);

export const adminRollupOrgsDaily = appSchema.table(
  'admin_rollup_orgs_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    orgId: uuid('org_id').notNull(),
    planCode: text('plan_code'),
    activeUsers: integer('active_users').notNull(),
    seats: integer('seats').notNull(),
    storageBytes: big('storage_bytes').notNull(),
    filesCount: integer('files_count').notNull(),
  },
  (t) => [primaryKey({ name: 'admin_rollup_orgs_daily_pkey', columns: [t.day, t.orgId] })],
);

export const adminRollupSourcesHourly = appSchema.table(
  'admin_rollup_sources_hourly',
  {
    hour: tstz('hour').notNull(),
    source: text('source').notNull(),
    requests: integer('requests').notNull(),
    errors: integer('errors').notNull(),
    p95Ms: integer('p95_ms'),
    breakerState: text('breaker_state').notNull(),
    bucketFillPct: integer('bucket_fill_pct'),
    liveFallbackCount: integer('live_fallback_count').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'admin_rollup_sources_hourly_pkey', columns: [t.hour, t.source] }),
    inList('admin_rollup_sources_hourly', t.breakerState, BREAKER_STATES),
  ],
);

export const adminRollupProductDaily = appSchema.table(
  'admin_rollup_product_daily',
  {
    day: date('day', { mode: 'string' }).notNull(),
    metric: text('metric').notNull(),
    value: big('value').notNull(),
  },
  (t) => [
    primaryKey({ name: 'admin_rollup_product_daily_pkey', columns: [t.day, t.metric] }),
    inList('admin_rollup_product_daily', t.metric, PRODUCT_METRIC_CODES),
  ],
);

/** Ay × `partner_code` × büro: kredi kullanımı, ödenen tutar (kullanıcı kırılımı YOK). */
export const partnerRollupMonthly = appSchema.table(
  'partner_rollup_monthly',
  {
    month: date('month', { mode: 'string' }).notNull(),
    partnerCode: text('partner_code').notNull(),
    orgId: uuid('org_id').notNull(),
    creditsUsed: big('credits_used').notNull(),
    paidAmountKurus: big('paid_amount_kurus').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'partner_rollup_monthly_pkey',
      columns: [t.month, t.partnerCode, t.orgId],
    }),
    check('partner_rollup_monthly_month_chk', sql`extract(day FROM ${col('month')}) = 1`),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type AuditSeal = typeof auditSeals.$inferSelect;
export type DeletionLogEntry = typeof deletionLog.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type SystemSetting = typeof systemSettings.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type OrgClosure = typeof orgClosures.$inferSelect;
export type KvkkRequest = typeof kvkkRequests.$inferSelect;
export type ProductEvent = typeof productEvents.$inferSelect;
export type SupportAccessGrant = typeof supportAccessGrants.$inferSelect;
export type EmailDelivery = typeof emailDeliveries.$inferSelect;
