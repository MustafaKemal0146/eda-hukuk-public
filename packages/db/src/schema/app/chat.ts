// `app` sohbet, atıf, arama (030 §7). Mesajlar maskesiz saklanır; `llm_parts` ve `reasoning` bayt
// kararlı `json` (rawJson; 030 Tuzak 9), `llm_context` `text`. `messages` fillfactor = 90, başlık
// harmanlaması ve `ON DELETE SET NULL (kolon)` migrasyonda yamadır.
import {
  AI_PROVIDER_REGIONS,
  DATA_CLASSES,
  FEEDBACK_CATEGORIES,
  MESSAGE_ROLES,
  MESSAGE_STATUSES,
  PROMPT_LIBRARY_SCOPES,
  SOURCE_KINDS,
  SOURCE_ORIGINS,
  THINKING_LEVELS,
} from '@eda/contracts/enums';
import { MODEL_ALIASES } from '@eda/contracts/stream';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { col, createdAt, fk, idV7, tstz, updatedAt } from '../_columns.ts';
import { rawJson } from '../_types.ts';
import { organizations, users } from '../auth.ts';
import { cases } from './case.ts';
import { appSchema } from './partners.ts';

const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const orgIdRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id);

/** Sohbet: varsayılan özel; sınıf yalnız yükselir (`app.guard_conversation_data_class`). */
export const conversations = appSchema.table(
  'conversations',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    caseId: uuid('case_id'),
    title: text('title'),
    titleFold: text('title_fold'),
    dataClass: text('data_class').notNull().default('client'),
    sharedWithCase: boolean('shared_with_case').notNull().default(false),
    publicModeDeclaredAt: tstz('public_mode_declared_at'),
    nextSourceLabel: integer('next_source_label').notNull().default(1),
    maskerVersion: text('masker_version'),
    lastModelAlias: text('last_model_alias'),
    summary: text('summary'),
    summaryThroughMessageId: uuid('summary_through_message_id'),
    summaryUpdatedAt: tstz('summary_updated_at'),
    lastMessageAt: tstz('last_message_at').notNull().defaultNow(),
    archivedAt: tstz('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('conversations_org_id_uq').on(t.orgId, t.id),
    inList('conversations', t.dataClass, DATA_CLASSES),
    check('conversations_next_source_label_chk', sql`${col('next_source_label')} >= 1`),
    inList('conversations', t.lastModelAlias, MODEL_ALIASES),
    check(
      'conversations_public_chk',
      sql`${col('data_class')} <> 'public' OR ${col('public_mode_declared_at')} IS NOT NULL`,
    ),
    check(
      'conversations_case_chk',
      sql`${col('case_id')} IS NULL OR ${col('data_class')} = 'case'`,
    ),
    check(
      'conversations_share_chk',
      sql`NOT ${col('shared_with_case')} OR ${col('case_id')} IS NOT NULL`,
    ),
    fk('conversations_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]),
    index('conversations_user_idx').on(t.orgId, t.userId, t.lastMessageAt.desc()),
    index('conversations_case_idx')
      .on(t.orgId, t.caseId, t.lastMessageAt.desc())
      .where(notNull('case_id')),
    index('conversations_inactive_idx').on(t.lastMessageAt),
    index('conversations_owner_idx').on(t.userId),
  ],
);

/** Mesaj (AI SDK UIMessage parçaları + LLM transkripti). */
export const messages = appSchema.table(
  'messages',
  {
    id: idV7(),
    orgId: orgIdRef(),
    conversationId: uuid('conversation_id').notNull(),
    role: text('role').notNull(),
    status: text('status').notNull().default('complete'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    parts: jsonb('parts').notNull().default(sql`'[]'::jsonb`),
    llmParts: rawJson('llm_parts'),
    llmContext: text('llm_context'),
    reasoning: rawJson('reasoning'),
    modelAlias: text('model_alias'),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    region: text('region'),
    dataClass: text('data_class'),
    thinking: text('thinking'),
    corrections: jsonb('corrections'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    inTranscript: boolean('in_transcript').notNull().default(true),
    replyToMessageId: uuid('reply_to_message_id'),
    documentId: uuid('document_id'),
    errorCode: text('error_code'),
    finishReason: text('finish_reason'),
    requestId: text('request_id'),
    completedAt: tstz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('messages_org_id_uq').on(t.orgId, t.id),
    inList('messages', t.role, MESSAGE_ROLES),
    inList('messages', t.status, MESSAGE_STATUSES),
    inList('messages', t.modelAlias, MODEL_ALIASES),
    inList('messages', t.region, AI_PROVIDER_REGIONS),
    inList('messages', t.dataClass, DATA_CLASSES),
    inList('messages', t.thinking, THINKING_LEVELS),
    check(
      'messages_status_role_chk',
      sql`${col('role')} = 'assistant' OR ${col('status')} = 'complete'`,
    ),
    check(
      'messages_reasoning_chk',
      sql`${col('role')} = 'assistant' OR ${col('reasoning')} IS NULL`,
    ),
    check('messages_context_chk', sql`${col('role')} = 'user' OR ${col('llm_context')} IS NULL`),
    fk(
      'messages_conversation_fk',
      [t.orgId, t.conversationId],
      [conversations.orgId, conversations.id],
    ).onDelete('cascade'),
    index('messages_conversation_order_idx').on(t.orgId, t.conversationId, t.createdAt, t.id),
    uniqueIndex('messages_one_streaming_turn_idx')
      .on(t.conversationId)
      .where(sql`${col('status')} IN (${sqlValueList(['streaming'])}) AND ${col('in_transcript')}`),
    uniqueIndex('messages_one_streaming_docjob_idx')
      .on(t.documentId)
      .where(
        sql`${col('status')} IN (${sqlValueList(['streaming'])}) AND ${col('document_id')} IS NOT NULL`,
      ),
    index('messages_streaming_idx')
      .on(t.createdAt)
      .where(sql`${col('status')} IN (${sqlValueList(['streaming'])})`),
    index('messages_reasoning_idx').on(t.conversationId).where(notNull('reasoning')),
    index('messages_user_idx').on(t.userId).where(notNull('user_id')),
  ],
);

/** `[K#]` kaynak eşlemesi: etiket bir kez verilir, değişmez (030 §7). */
export const messageSources = appSchema.table(
  'message_sources',
  {
    id: idV7(),
    orgId: orgIdRef(),
    conversationId: uuid('conversation_id').notNull(),
    messageId: uuid('message_id'),
    refNo: integer('ref_no').notNull(),
    sourceKind: text('source_kind').notNull(),
    origin: text('origin').notNull(),
    sourceKey: text('source_key').notNull(),
    sourceId: uuid('source_id'),
    kunyeSnapshot: jsonb('kunye_snapshot').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check('message_sources_ref_no_chk', sql`${col('ref_no')} >= 1`),
    inList('message_sources', t.sourceKind, SOURCE_KINDS),
    inList('message_sources', t.origin, SOURCE_ORIGINS),
    unique('message_sources_org_id_uq').on(t.orgId, t.id),
    unique('message_sources_ref_uq').on(t.orgId, t.conversationId, t.refNo),
    unique('message_sources_key_uq').on(t.orgId, t.conversationId, t.sourceKey),
    fk(
      'message_sources_conversation_fk',
      [t.orgId, t.conversationId],
      [conversations.orgId, conversations.id],
    ).onDelete('cascade'),
    fk(
      'message_sources_message_fk',
      [t.orgId, t.messageId],
      [messages.orgId, messages.id],
    ).onDelete('set null'),
    index('message_sources_message_idx').on(t.orgId, t.messageId).where(notNull('message_id')),
  ],
);

/** Mesaj geri bildirimi: yalnız puan + kategori. */
export const messageFeedback = appSchema.table(
  'message_feedback',
  {
    id: idV7(),
    orgId: orgIdRef(),
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    category: text('category'),
    createdAt: createdAt(),
  },
  (t) => [
    check('message_feedback_rating_chk', sql`${col('rating')} IN (-1, 1)`),
    inList('message_feedback', t.category, FEEDBACK_CATEGORIES),
    unique('message_feedback_uq').on(t.orgId, t.messageId, t.userId),
    fk(
      'message_feedback_message_fk',
      [t.orgId, t.messageId],
      [messages.orgId, messages.id],
    ).onDelete('cascade'),
    index('message_feedback_user_idx').on(t.userId),
  ],
);

/** Açık onaylı maskeli kalite paylaşımı (90 gün). */
export const feedbackShares = appSchema.table(
  'feedback_shares',
  {
    id: idV7(),
    orgId: orgIdRef(),
    messageId: uuid('message_id'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    maskedContent: jsonb('masked_content').notNull(),
    modelAlias: text('model_alias').notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    promptVersionId: uuid('prompt_version_id'),
    maskerVersion: text('masker_version').notNull(),
    sourceKeys: text('source_keys').array().notNull().default(sql`'{}'::text[]`),
    supportTicketId: uuid('support_ticket_id'),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    fk(
      'feedback_shares_message_fk',
      [t.orgId, t.messageId],
      [messages.orgId, messages.id],
    ).onDelete('set null'),
    index('feedback_shares_org_idx').on(t.orgId, t.createdAt.desc()),
    index('feedback_shares_msg_idx').on(t.orgId, t.messageId).where(notNull('message_id')),
    index('feedback_shares_purge_idx').on(t.expiresAt),
    index('feedback_shares_user_idx').on(t.userId).where(notNull('user_id')),
  ],
);

/** Kayıtlı istemler: büro (`scope = 'org'`) / kişisel (`scope = 'user'`). */
export const promptLibrary = appSchema.table(
  'prompt_library',
  {
    id: idV7(),
    orgId: orgIdRef(),
    scope: text('scope').notNull(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    titleFold: text('title_fold').notNull(),
    body: text('body').notNull(),
    category: text('category'),
    usageCount: integer('usage_count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('prompt_library', t.scope, PROMPT_LIBRARY_SCOPES),
    check(
      'prompt_library_scope_owner_chk',
      sql`(${col('scope')} = 'user') = (${col('owner_user_id')} IS NOT NULL)`,
    ),
    index('prompt_library_org_idx').on(t.orgId, t.scope, t.ownerUserId),
    index('prompt_library_owner_idx').on(t.ownerUserId).where(notNull('owner_user_id')),
  ],
);

/** Karar Arşivi `searchId` -> sorgu + filtreler (24 saat; sorgu URL'de taşınmaz). */
export const decisionSearches = appSchema.table(
  'decision_searches',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    query: text('query').notNull(),
    filters: jsonb('filters').notNull().default(sql`'{}'::jsonb`),
    resultIds: uuid('result_ids').array().notNull().default(sql`'{}'::uuid[]`),
    liveRequestedAt: tstz('live_requested_at'),
    overview: text('overview'),
    expiresAt: tstz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('decision_searches_user_idx').on(t.orgId, t.userId, t.createdAt.desc()),
    index('decision_searches_purge_idx').on(t.expiresAt),
    index('decision_searches_owner_idx').on(t.userId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageSource = typeof messageSources.$inferSelect;
export type MessageFeedback = typeof messageFeedback.$inferSelect;
export type FeedbackShare = typeof feedbackShares.$inferSelect;
export type PromptLibraryEntry = typeof promptLibrary.$inferSelect;
export type DecisionSearch = typeof decisionSearches.$inferSelect;
