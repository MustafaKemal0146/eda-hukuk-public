// `app` belge (030 §8): şablon, belge, sürüm, öneri, dışa aktarım. `documents` fillfactor = 90,
// başlık harmanlaması ve `ON DELETE SET NULL (kolon)` migrasyonda yamadır. 030 §7'deki
// `message_citations` (belge atıfları) ve `kunye_checks` (rapor dışa aktarımı) belge tablolarıyla
// karşılıklı FK taşıdığı için döngüsel modül içe aktarması olmasın diye bu dosyadadır.
import {
  DOCUMENT_EXPORT_STATUSES,
  DOCUMENT_GENERATION_STATUSES,
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  DOCUMENT_SUBTYPES,
  DOCUMENT_VERSION_SOURCES,
  DOCUMENT_VERSION_TRIGGERS,
  EXPORT_DATA_SCOPES,
  EXPORT_FORMATS,
  EXPORT_SUBJECT_TYPES,
  KUNYE_CHECK_STATUSES,
  KUNYE_STATUSES,
  SUGGESTION_STATUSES,
} from '@eda/contracts/enums';
import { CITATION_REASONS } from '@eda/contracts/stream';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  type PgTableExtraConfigValue,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { col, createdAt, fk, idV7, tstz, updatedAt } from '../_columns.ts';
import { bytea } from '../_types.ts';
import { organizations, users } from '../auth.ts';
import { cases, files } from './case.ts';
import { caseTypes } from './catalog.ts';
import { conversations, messageSources, messages } from './chat.ts';
import { orgKeys } from './org.ts';
import { appSchema } from './partners.ts';

const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const orgIdRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id);

/** Dilekçe şablonları: `org_id NULL` = platform şablonu (herkes okur), aksi büro şablonu. */
export const templates = appSchema.table(
  'templates',
  {
    id: idV7(),
    orgId: uuid('org_id').references(() => organizations.id),
    kind: text('kind').notNull(),
    /** Alt tür (080 §1.3; P17b expand); NULL = genel şablon. */
    subtype: text('subtype'),
    title: text('title').notNull(),
    description: text('description'),
    caseTypeCode: text('case_type_code').references(() => caseTypes.code),
    content: jsonb('content').notNull(),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('templates', t.kind, DOCUMENT_KINDS),
    inList('templates', t.subtype, DOCUMENT_SUBTYPES),
    index('templates_org_idx').on(t.orgId, t.kind).where(notNull('org_id')),
    index('templates_platform_idx')
      .on(t.kind)
      .where(sql`${col('org_id')} IS NULL`),
    index('templates_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Belge: taslak alanı TipTap JSON (sürüm değil); `draft_rev` = API `baseVersion`. */
export const documents = appSchema.table(
  'documents',
  {
    id: idV7(),
    orgId: orgIdRef(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    caseId: uuid('case_id'),
    sourceConversationId: uuid('source_conversation_id'),
    respondsToFileId: uuid('responds_to_file_id'),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    /** Alt tür (080 §1.3; P17b expand); NULL = belirtilmemiş. */
    subtype: text('subtype'),
    status: text('status').notNull().default('draft'),
    title: text('title').notNull(),
    titleFold: text('title_fold').notNull(),
    draft: jsonb('draft').notNull(),
    draftRev: bigint('draft_rev', { mode: 'number' }).notNull().default(0),
    draftSavedAt: tstz('draft_saved_at'),
    outline: jsonb('outline'),
    generationStatus: text('generation_status').notNull().default('idle'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: tstz('approved_at'),
    filedDeclaredBy: uuid('filed_declared_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    filedDeclaredAt: tstz('filed_declared_at'),
    archivedAt: tstz('archived_at'),
    lastExportedAt: tstz('last_exported_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('documents_org_id_uq').on(t.orgId, t.id),
    inList('documents', t.kind, DOCUMENT_KINDS),
    inList('documents', t.subtype, DOCUMENT_SUBTYPES),
    inList('documents', t.status, DOCUMENT_STATUSES),
    inList('documents', t.generationStatus, DOCUMENT_GENERATION_STATUSES),
    check(
      'documents_filed_chk',
      sql`(${col('status')} = 'filed_declared') <= (${col('filed_declared_at')} IS NOT NULL)`,
    ),
    fk('documents_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]),
    fk(
      'documents_source_conversation_fk',
      [t.orgId, t.sourceConversationId],
      [conversations.orgId, conversations.id],
    ).onDelete('set null'),
    fk(
      'documents_responds_to_file_fk',
      [t.orgId, t.respondsToFileId],
      [files.orgId, files.id],
    ).onDelete('set null'),
    index('documents_owner_idx').on(t.orgId, t.ownerId, t.createdAt.desc()),
    index('documents_case_idx').on(t.orgId, t.caseId).where(notNull('case_id')),
    index('documents_conv_idx')
      .on(t.orgId, t.sourceConversationId)
      .where(notNull('source_conversation_id')),
    index('documents_responds_idx')
      .on(t.orgId, t.respondsToFileId)
      .where(notNull('responds_to_file_id')),
    index('documents_template_idx').on(t.templateId).where(notNull('template_id')),
    index('documents_owner_user_idx').on(t.ownerId),
    index('documents_approved_by_idx').on(t.approvedBy).where(notNull('approved_by')),
    index('documents_filed_declared_by_idx')
      .on(t.filedDeclaredBy)
      .where(notNull('filed_declared_by')),
  ],
);

/** Tam kopya sürümler (değişmez; yalnız `name` güncellenebilir). */
export const documentVersions = appSchema.table(
  'document_versions',
  {
    id: idV7(),
    orgId: orgIdRef(),
    documentId: uuid('document_id').notNull(),
    versionNo: integer('version_no').notNull(),
    source: text('source').notNull(),
    trigger: text('trigger').notNull(),
    name: text('name'),
    content: jsonb('content').notNull(),
    baseDraftRev: bigint('base_draft_rev', { mode: 'number' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('document_versions_version_no_chk', sql`${col('version_no')} >= 1`),
    inList('document_versions', t.source, DOCUMENT_VERSION_SOURCES),
    inList('document_versions', t.trigger, DOCUMENT_VERSION_TRIGGERS),
    unique('document_versions_org_id_uq').on(t.orgId, t.id),
    unique('document_versions_no_uq').on(t.orgId, t.documentId, t.versionNo),
    fk(
      'document_versions_document_fk',
      [t.orgId, t.documentId],
      [documents.orgId, documents.id],
    ).onDelete('cascade'),
    index('document_versions_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Blok kimlikli öneri op listesi (RFC 6902 KULLANILMAZ). */
export const documentSuggestions = appSchema.table(
  'document_suggestions',
  {
    id: idV7(),
    orgId: orgIdRef(),
    documentId: uuid('document_id').notNull(),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    baseRev: bigint('base_rev', { mode: 'number' }).notNull(),
    ops: jsonb('ops').notNull(),
    status: text('status').notNull().default('pending'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: tstz('resolved_at'),
    resultingVersionId: uuid('resulting_version_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'document_suggestions_ops_chk',
      sql`jsonb_typeof(${col('ops')}) = 'array' AND jsonb_array_length(${col('ops')}) > 0`,
    ),
    inList('document_suggestions', t.status, SUGGESTION_STATUSES),
    fk(
      'document_suggestions_document_fk',
      [t.orgId, t.documentId],
      [documents.orgId, documents.id],
    ).onDelete('cascade'),
    fk(
      'document_suggestions_conversation_fk',
      [t.orgId, t.conversationId],
      [conversations.orgId, conversations.id],
    ).onDelete('set null'),
    fk(
      'document_suggestions_message_fk',
      [t.orgId, t.messageId],
      [messages.orgId, messages.id],
    ).onDelete('set null'),
    fk(
      'document_suggestions_version_fk',
      [t.orgId, t.resultingVersionId],
      [documentVersions.orgId, documentVersions.id],
    ).onDelete('set null'),
    index('document_suggestions_doc_idx').on(t.orgId, t.documentId, t.createdAt.desc()),
    index('document_suggestions_pending_idx')
      .on(t.orgId, t.documentId)
      .where(sql`${col('status')} IN (${sqlValueList(['pending'])})`),
    index('document_suggestions_conv_idx')
      .on(t.orgId, t.conversationId)
      .where(notNull('conversation_id')),
    index('document_suggestions_msg_idx').on(t.orgId, t.messageId).where(notNull('message_id')),
    index('document_suggestions_version_idx')
      .on(t.orgId, t.resultingVersionId)
      .where(notNull('resulting_version_id')),
    index('document_suggestions_requested_by_idx').on(t.requestedBy).where(notNull('requested_by')),
    index('document_suggestions_resolved_by_idx').on(t.resolvedBy).where(notNull('resolved_by')),
  ],
);

/** Tüm `eda-exports` nesneleri (`subject_type`; 033 §12, 035 §10). */
export const documentExports = appSchema.table(
  'document_exports',
  {
    id: idV7(),
    orgId: orgIdRef(),
    subjectType: text('subject_type').notNull(),
    dataScope: text('data_scope'),
    format: text('format').notNull(),
    status: text('status').notNull().default('queued'),
    documentId: uuid('document_id'),
    versionId: uuid('version_id'),
    caseId: uuid('case_id'),
    conversationId: uuid('conversation_id'),
    kunyeCheckId: uuid('kunye_check_id'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    objectKey: text('object_key'),
    keyVersion: integer('key_version'),
    wrapDekVersion: integer('wrap_dek_version'),
    wrappedKey: bytea('wrapped_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    sha256: bytea('sha256'),
    citationOverride: boolean('citation_override').notNull().default(false),
    checklist: jsonb('checklist'),
    errorCode: text('error_code'),
    expiresAt: tstz('expires_at'),
    completedAt: tstz('completed_at'),
    createdAt: createdAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    inList('document_exports', t.subjectType, EXPORT_SUBJECT_TYPES),
    inList('document_exports', t.dataScope, EXPORT_DATA_SCOPES),
    inList('document_exports', t.format, EXPORT_FORMATS),
    inList('document_exports', t.status, DOCUMENT_EXPORT_STATUSES),
    unique('document_exports_object_key_uq').on(t.objectKey),
    check(
      'document_exports_sha256_chk',
      sql`${col('sha256')} IS NULL OR octet_length(${col('sha256')}) = 32`,
    ),
    unique('document_exports_org_id_uq').on(t.orgId, t.id),
    check(
      'document_exports_ready_chk',
      sql`${col('status')} <> 'ready' OR (${col('object_key')} IS NOT NULL AND ${col('key_version')} IS NOT NULL AND ${col('wrap_dek_version')} IS NOT NULL AND ${col('wrapped_key')} IS NOT NULL)`,
    ),
    check(
      'document_exports_subject_chk',
      sql`(${col('subject_type')} = 'document' AND ${col('document_id')} IS NOT NULL) OR (${col('subject_type')} = 'case_ai_log' AND ${col('case_id')} IS NOT NULL) OR (${col('subject_type')} = 'conversation' AND ${col('conversation_id')} IS NOT NULL) OR (${col('subject_type')} = 'kunye_check' AND ${col('kunye_check_id')} IS NOT NULL) OR (${col('subject_type')} = 'data' AND ${col('data_scope')} IS NOT NULL) OR (${col('subject_type')} = 'case_files' AND ${col('case_id')} IS NOT NULL)`,
    ),
    fk(
      'document_exports_document_fk',
      [t.orgId, t.documentId],
      [documents.orgId, documents.id],
    ).onDelete('set null'),
    fk(
      'document_exports_version_fk',
      [t.orgId, t.versionId],
      [documentVersions.orgId, documentVersions.id],
    ).onDelete('set null'),
    fk('document_exports_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]).onDelete(
      'set null',
    ),
    fk(
      'document_exports_conversation_fk',
      [t.orgId, t.conversationId],
      [conversations.orgId, conversations.id],
    ).onDelete('set null'),
    fk(
      'document_exports_kunye_check_fk',
      [t.orgId, t.kunyeCheckId],
      [kunyeChecks.orgId, kunyeChecks.id],
    ).onDelete('set null'),
    fk(
      'document_exports_wrap_dek_fk',
      [t.orgId, t.wrapDekVersion],
      [orgKeys.orgId, orgKeys.keyVersion],
    ),
    index('document_exports_doc_idx')
      .on(t.orgId, t.documentId, t.createdAt.desc())
      .where(notNull('document_id')),
    index('document_exports_case_idx').on(t.orgId, t.caseId).where(notNull('case_id')),
    index('document_exports_conv_idx')
      .on(t.orgId, t.conversationId)
      .where(notNull('conversation_id')),
    index('document_exports_check_idx')
      .on(t.orgId, t.kunyeCheckId)
      .where(notNull('kunye_check_id')),
    index('document_exports_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${col('status')} IN (${sqlValueList(['ready'])})`),
    index('document_exports_version_idx').on(t.orgId, t.versionId).where(notNull('version_id')),
    index('document_exports_wrap_dek_idx')
      .on(t.orgId, t.wrapDekVersion)
      .where(notNull('wrap_dek_version')),
    index('document_exports_requested_by_idx').on(t.requestedBy).where(notNull('requested_by')),
  ],
);

/** Künye Kilidi sonuçları (mesaj VE belge atıfları; `message_id`/`document_id`'den yalnız biri). */
export const messageCitations = appSchema.table(
  'message_citations',
  {
    id: idV7(),
    orgId: orgIdRef(),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    documentId: uuid('document_id'),
    blockId: text('block_id'),
    messageSourceId: uuid('message_source_id'),
    refNo: integer('ref_no'),
    raw: text('raw').notNull(),
    parsed: jsonb('parsed').notNull().default(sql`'{}'::jsonb`),
    quote: text('quote'),
    status: text('status').notNull().default('pending'),
    reason: text('reason'),
    blocking: text('blocking').generatedAlwaysAs(
      sql`CASE ${col('status')} WHEN 'not_found' THEN 'hard' WHEN 'source_unavailable' THEN 'soft' ELSE 'none' END`,
    ),
    sourceId: uuid('source_id'),
    userSourceFileId: uuid('user_source_file_id'),
    attestedBy: uuid('attested_by').references(() => users.id, { onDelete: 'set null' }),
    attestedAt: tstz('attested_at'),
    checkAttempts: integer('check_attempts').notNull().default(0),
    lastCheckedAt: tstz('last_checked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('message_citations', t.status, KUNYE_STATUSES),
    inList('message_citations', t.reason, CITATION_REASONS),
    check(
      'message_citations_owner_chk',
      sql`num_nonnulls(${col('message_id')}, ${col('document_id')}) = 1`,
    ),
    check(
      'message_citations_attest_chk',
      sql`${col('status')} <> 'attested' OR ${col('attested_at')} IS NOT NULL`,
    ),
    fk(
      'message_citations_conversation_fk',
      [t.orgId, t.conversationId],
      [conversations.orgId, conversations.id],
    ).onDelete('cascade'),
    fk(
      'message_citations_message_fk',
      [t.orgId, t.messageId],
      [messages.orgId, messages.id],
    ).onDelete('cascade'),
    fk(
      'message_citations_document_fk',
      [t.orgId, t.documentId],
      [documents.orgId, documents.id],
    ).onDelete('cascade'),
    fk(
      'message_citations_source_fk',
      [t.orgId, t.messageSourceId],
      [messageSources.orgId, messageSources.id],
    ).onDelete('set null'),
    fk(
      'message_citations_user_source_fk',
      [t.orgId, t.userSourceFileId],
      [files.orgId, files.id],
    ).onDelete('set null'),
    index('message_citations_message_idx').on(t.orgId, t.messageId).where(notNull('message_id')),
    index('message_citations_document_idx')
      .on(t.orgId, t.documentId, t.status)
      .where(notNull('document_id')),
    index('message_citations_conv_idx')
      .on(t.orgId, t.conversationId)
      .where(notNull('conversation_id')),
    index('message_citations_verify_idx')
      .on(t.lastCheckedAt)
      .where(sql`${col('status')} IN (${sqlValueList(['pending', 'source_unavailable'])})`),
    index('message_citations_source_idx')
      .on(t.orgId, t.messageSourceId)
      .where(notNull('message_source_id')),
    index('message_citations_user_source_idx')
      .on(t.orgId, t.userSourceFileId)
      .where(notNull('user_source_file_id')),
    index('message_citations_attested_by_idx').on(t.attestedBy).where(notNull('attested_by')),
  ],
);

/** Künye Kontrolü çalıştırmaları (30 gün). */
export const kunyeChecks = appSchema.table(
  'kunye_checks',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id'),
    status: text('status').notNull().default('queued'),
    summary: jsonb('summary').notNull().default(sql`'{}'::jsonb`),
    results: jsonb('results').notNull().default(sql`'[]'::jsonb`),
    reportExportId: uuid('report_export_id'),
    errorCode: text('error_code'),
    expiresAt: tstz('expires_at').notNull(),
    completedAt: tstz('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    inList('kunye_checks', t.status, KUNYE_CHECK_STATUSES),
    unique('kunye_checks_org_id_uq').on(t.orgId, t.id),
    fk('kunye_checks_file_fk', [t.orgId, t.fileId], [files.orgId, files.id]).onDelete('set null'),
    fk(
      'kunye_checks_report_export_fk',
      [t.orgId, t.reportExportId],
      [documentExports.orgId, documentExports.id],
    ).onDelete('set null'),
    index('kunye_checks_user_idx').on(t.orgId, t.userId, t.createdAt.desc()),
    index('kunye_checks_file_idx').on(t.orgId, t.fileId).where(notNull('file_id')),
    index('kunye_checks_purge_idx').on(t.expiresAt),
    index('kunye_checks_owner_idx').on(t.userId),
    index('kunye_checks_report_idx')
      .on(t.orgId, t.reportExportId)
      .where(notNull('report_export_id')),
  ],
);

export type Template = typeof templates.$inferSelect;
export type LegalDocument = typeof documents.$inferSelect;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type DocumentSuggestion = typeof documentSuggestions.$inferSelect;
export type DocumentExport = typeof documentExports.$inferSelect;
export type MessageCitation = typeof messageCitations.$inferSelect;
export type KunyeCheck = typeof kunyeChecks.$inferSelect;
