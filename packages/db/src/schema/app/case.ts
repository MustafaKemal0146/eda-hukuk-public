// `app` müvekkil, dava, evrak (030 §6). Kiracı içi bağlar bileşik FK'dir: `(org_id, x_id) ->
// parent(org_id, id)` (030 §1.4). Migrasyonda yamalı olanlar: harmanlama, `ON DELETE SET NULL
// (kolon)`, `GENERATED tsvector`, `custody_events` aylık RANGE bölümleme (030 §1.9).
import {
  ACCEPTED_FILE_TYPES,
  AI_PROVIDER_REGIONS,
  AI_TASKS,
  AUDIT_ACTOR_TYPES,
  CASE_AI_LOG_OUTCOMES,
  CASE_SENSITIVITIES,
  CASE_STATUSES,
  CASE_VISIBILITIES,
  CLIENT_AI_CONSENTS,
  CLIENT_KINDS,
  CUSTODY_EVENTS,
  DATA_CLASSES,
  EXTRACTION_METHODS,
  FILE_CARD_STATUSES,
  FILE_DOC_TYPES,
  FILE_ORIGINS,
  FILE_STATUSES,
  PARTY_ROLES,
  PENDING_FILE_JOB_NAMES,
  PENDING_FILE_QUEUES,
  POWER_OF_ATTORNEY_SCOPE_KINDS,
  SENSITIVE_TOPIC_CODES,
} from '@eda/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  halfvec,
  index,
  inet,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { col, createdAt, fk, idV7, idV7NoPk, tstz, updatedAt } from '../_columns.ts';
import { bytea, tsvector } from '../_types.ts';
import { members, organizations, users } from '../auth.ts';
import { caseTypes, chambers, courts } from './catalog.ts';
import { orgKeys } from './org.ts';
import { appSchema } from './partners.ts';

/** `display_name` üretilmiş kolonu (kişi: ad + soyad, kurum: unvan). */
const displayNameExpr = sql`CASE WHEN ${col('kind')} = 'person' THEN ${col('first_name')} || ' ' || ${col('last_name')} ELSE ${col('entity_name')} END`;

/** Kişi/kurum ad alanı tutarlılığı (kurumda TCKN yok). */
const partyKindCheck = (table: string) =>
  check(
    `${table}_kind_shape_chk`,
    sql`(${col('kind')} = 'person' AND ${col('first_name')} IS NOT NULL AND ${col('last_name')} IS NOT NULL AND ${col('entity_name')} IS NULL) OR (${col('kind')} = 'entity' AND ${col('entity_name')} IS NOT NULL AND ${col('first_name')} IS NULL AND ${col('last_name')} IS NULL AND ${col('tckn_enc')} IS NULL)`,
  );
const encPairCheck = (table: string) =>
  check(
    `${table}_enc_pair_chk`,
    sql`(${col('tckn_enc')} IS NULL) = (${col('tckn_hmac')} IS NULL) AND (${col('vkn_enc')} IS NULL) = (${col('vkn_hmac')} IS NULL)`,
  );
const encKeyCheck = (table: string) =>
  check(
    `${table}_enc_key_chk`,
    sql`(${col('tckn_enc')} IS NULL AND ${col('vkn_enc')} IS NULL) OR ${col('pii_org_key_id')} IS NOT NULL`,
  );

const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const orgIdRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id);

/** Müvekkil (kişi/kurum); TCKN/VKN uygulama düzeyi şifreli + HMAC (030 §1.7b). */
export const clients = appSchema.table(
  'clients',
  {
    id: idV7(),
    orgId: orgIdRef(),
    kind: text('kind').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    entityName: text('entity_name'),
    displayName: text('display_name').generatedAlwaysAs(displayNameExpr),
    nameFold: text('name_fold').notNull(),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    tcknEnc: bytea('tckn_enc'),
    tcknHmac: bytea('tckn_hmac'),
    vknEnc: bytea('vkn_enc'),
    vknHmac: bytea('vkn_hmac'),
    piiOrgKeyId: uuid('pii_org_key_id'),
    taxOffice: text('tax_office'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('clients_org_id_uq').on(t.orgId, t.id),
    inList('clients', t.kind, CLIENT_KINDS),
    partyKindCheck('clients'),
    encPairCheck('clients'),
    encKeyCheck('clients'),
    fk('clients_pii_org_key_fk', [t.orgId, t.piiOrgKeyId], [orgKeys.orgId, orgKeys.id]),
    index('clients_org_name_idx').on(t.orgId, t.nameFold.op('text_pattern_ops')),
    uniqueIndex('clients_org_tckn_uq').on(t.orgId, t.tcknHmac).where(notNull('tckn_hmac')),
    uniqueIndex('clients_org_vkn_uq').on(t.orgId, t.vknHmac).where(notNull('vkn_hmac')),
    index('clients_pii_key_idx').on(t.orgId, t.piiOrgKeyId).where(notNull('pii_org_key_id')),
    index('clients_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Dava dosyası (030 §6; `visibility`, `sensitivity`, saklama alanları). */
export const cases = appSchema.table(
  'cases',
  {
    id: idV7(),
    orgId: orgIdRef(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    titleFold: text('title_fold').notNull(),
    officeFileCode: text('office_file_code'),
    shortName: text('short_name'),
    caseTypeCode: text('case_type_code').references(() => caseTypes.code),
    courtCode: text('court_code').references(() => courts.code),
    chamberCode: text('chamber_code').references(() => chambers.code),
    esasNo: text('esas_no'),
    kararNo: text('karar_no'),
    status: text('status').notNull().default('active'),
    visibility: text('visibility').notNull().default('org'),
    sensitivity: text('sensitivity').notNull().default('normal'),
    sensitiveTopic: text('sensitive_topic'),
    clientAiConsent: text('client_ai_consent').notNull().default('unknown'),
    aiDisabled: boolean('ai_disabled').notNull().default(false),
    openedDate: date('opened_date', { mode: 'string' }),
    closedDate: date('closed_date', { mode: 'string' }),
    mandateEndedAt: tstz('mandate_ended_at'),
    legalHold: boolean('legal_hold').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('cases_org_id_uq').on(t.orgId, t.id),
    check('cases_esas_no_chk', sql`char_length(${col('esas_no')}) <= 32`),
    check('cases_karar_no_chk', sql`char_length(${col('karar_no')}) <= 32`),
    inList('cases', t.status, CASE_STATUSES),
    inList('cases', t.visibility, CASE_VISIBILITIES),
    inList('cases', t.sensitivity, CASE_SENSITIVITIES),
    inList('cases', t.sensitiveTopic, SENSITIVE_TOPIC_CODES),
    inList('cases', t.clientAiConsent, CLIENT_AI_CONSENTS),
    check(
      'cases_consent_chk',
      sql`${col('client_ai_consent')} <> 'refused' OR ${col('ai_disabled')}`,
    ),
    check(
      'cases_topic_chk',
      sql`${col('sensitivity')} = 'sensitive' OR ${col('sensitive_topic')} IS NULL`,
    ),
    check(
      'cases_dates_chk',
      sql`${col('closed_date')} IS NULL OR ${col('opened_date')} IS NULL OR ${col('closed_date')} >= ${col('opened_date')}`,
    ),
    check(
      'cases_mandate_chk',
      sql`${col('status')} NOT IN (${sqlValueList(['closed', 'archived'])}) OR ${col('mandate_ended_at')} IS NOT NULL`,
    ),
    index('cases_org_status_idx').on(t.orgId, t.status, t.createdAt.desc()),
    index('cases_org_owner_idx').on(t.orgId, t.ownerId),
    index('cases_owner_idx').on(t.ownerId),
    index('cases_org_esas_idx').on(t.orgId, t.esasNo).where(notNull('esas_no')),
    index('cases_org_title_idx').on(t.orgId, t.titleFold.op('text_pattern_ops')),
    index('cases_retention_idx')
      .on(t.mandateEndedAt)
      .where(sql`${col('mandate_ended_at')} IS NOT NULL AND NOT ${col('legal_hold')}`),
    index('cases_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Kısıtlı dava ekibi (`visibility = 'restricted'`). */
export const caseMembers = appSchema.table(
  'case_members',
  {
    id: idV7(),
    orgId: orgIdRef(),
    caseId: uuid('case_id').notNull(),
    userId: uuid('user_id').notNull(),
    addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('case_members_uq').on(t.orgId, t.caseId, t.userId),
    fk('case_members_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]).onDelete('cascade'),
    fk(
      'case_members_member_fk',
      [t.orgId, t.userId],
      [members.organizationId, members.userId],
    ).onDelete('cascade'),
    index('case_members_user_idx').on(t.orgId, t.userId),
    index('case_members_added_by_idx').on(t.addedBy).where(notNull('added_by')),
  ],
);

/** Evrak, sohbet eki ve Künye Kontrolü yüklemesi (`case_id NULL` = inbox; 033). */
export const files = appSchema.table(
  'files',
  {
    id: idV7(),
    orgId: orgIdRef(),
    caseId: uuid('case_id'),
    origin: text('origin').notNull(),
    originId: uuid('origin_id'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    originalName: text('original_name').notNull(),
    nameFold: text('name_fold').notNull(),
    fileType: text('file_type').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: bytea('sha256').notNull(),
    pageCount: integer('page_count'),
    hasTextLayer: boolean('has_text_layer'),
    ocrPages: integer('ocr_pages').notNull().default(0),
    ocrCompletedAt: tstz('ocr_completed_at'),
    scannedAt: tstz('scanned_at'),
    embedPages: integer('embed_pages').notNull().default(0),
    embedCompletedAt: tstz('embed_completed_at'),
    progressDone: integer('progress_done'),
    progressTotal: integer('progress_total'),
    status: text('status').notNull().default('uploaded'),
    statusReason: text('status_reason'),
    objectKey: text('object_key').notNull(),
    hasSearchable: boolean('has_searchable').notNull().default(false),
    hasClean: boolean('has_clean').notNull().default(false),
    keyVersion: integer('key_version').notNull(),
    wrapDekVersion: integer('wrap_dek_version').notNull(),
    wrappedFileKey: bytea('wrapped_file_key').notNull(),
    deleteRequestedAt: tstz('delete_requested_at'),
    deleteRequestedBy: uuid('delete_requested_by'),
    inboxExpiresAt: tstz('inbox_expires_at'),
    readyAt: tstz('ready_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('files_org_id_uq').on(t.orgId, t.id),
    unique('files_object_key_uq').on(t.objectKey),
    inList('files', t.origin, FILE_ORIGINS),
    inList('files', t.fileType, ACCEPTED_FILE_TYPES),
    check('files_size_bytes_chk', sql`${col('size_bytes')} > 0`),
    check('files_sha256_chk', sql`octet_length(${col('sha256')}) = 32`),
    inList('files', t.status, FILE_STATUSES),
    check('files_wrapped_file_key_chk', sql`octet_length(${col('wrapped_file_key')}) = 60`),
    check(
      'files_inbox_chk',
      sql`(${col('case_id')} IS NULL) = (${col('inbox_expires_at')} IS NOT NULL)`,
    ),
    check(
      'files_vault_case_chk',
      sql`${col('origin')} <> 'case_upload' OR ${col('case_id')} IS NOT NULL`,
    ),
    fk('files_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]),
    fk('files_wrap_dek_fk', [t.orgId, t.wrapDekVersion], [orgKeys.orgId, orgKeys.keyVersion]),
    index('files_case_idx').on(t.orgId, t.caseId, t.createdAt.desc()),
    uniqueIndex('files_case_sha_uq')
      .on(t.orgId, t.caseId, t.sha256)
      .where(sql`${col('case_id')} IS NOT NULL AND ${col('delete_requested_at')} IS NULL`),
    index('files_inbox_purge_idx')
      .on(t.inboxExpiresAt)
      .where(sql`${col('case_id')} IS NULL`),
    index('files_processing_idx')
      .on(t.orgId, t.status)
      .where(
        sql`${col('status')} IN (${sqlValueList(['uploaded', 'scanning', 'extracting', 'chunking', 'embedding'])})`,
      ),
    index('files_org_key_idx').on(t.orgId, t.wrapDekVersion),
    index('files_uploaded_by_idx').on(t.uploadedBy).where(notNull('uploaded_by')),
  ],
);

/** Vekâletname (taranmış belge `file_id`). */
export const powersOfAttorney = appSchema.table(
  'powers_of_attorney',
  {
    id: idV7(),
    orgId: orgIdRef(),
    clientId: uuid('client_id').notNull(),
    notaryName: text('notary_name').notNull(),
    issuedDate: date('issued_date', { mode: 'string' }).notNull(),
    yevmiyeNo: text('yevmiye_no').notNull(),
    scopeKind: text('scope_kind').notNull(),
    scopeNote: text('scope_note'),
    startDate: date('start_date', { mode: 'string' }),
    endedAt: tstz('ended_at'),
    authorizedUserIds: uuid('authorized_user_ids').array().notNull().default(sql`'{}'::uuid[]`),
    fileId: uuid('file_id'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('powers_of_attorney', t.scopeKind, POWER_OF_ATTORNEY_SCOPE_KINDS),
    fk('powers_of_attorney_client_fk', [t.orgId, t.clientId], [clients.orgId, clients.id]).onDelete(
      'cascade',
    ),
    fk('powers_of_attorney_file_fk', [t.orgId, t.fileId], [files.orgId, files.id]).onDelete(
      'set null',
    ),
    index('powers_of_attorney_client_idx').on(t.orgId, t.clientId),
    index('powers_of_attorney_active_idx')
      .on(t.orgId)
      .where(sql`${col('ended_at')} IS NULL`),
    index('powers_of_attorney_file_idx').on(t.orgId, t.fileId).where(notNull('file_id')),
    index('powers_of_attorney_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Dava tarafları (maskeleme sözlüğü kaynağı). */
export const caseParties = appSchema.table(
  'case_parties',
  {
    id: idV7(),
    orgId: orgIdRef(),
    caseId: uuid('case_id').notNull(),
    clientId: uuid('client_id'),
    role: text('role').notNull(),
    kind: text('kind').notNull(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    entityName: text('entity_name'),
    displayName: text('display_name').generatedAlwaysAs(displayNameExpr),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    tcknEnc: bytea('tckn_enc'),
    tcknHmac: bytea('tckn_hmac'),
    vknEnc: bytea('vkn_enc'),
    vknHmac: bytea('vkn_hmac'),
    piiOrgKeyId: uuid('pii_org_key_id'),
    address: text('address'),
    counselName: text('counsel_name'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('case_parties', t.role, PARTY_ROLES),
    inList('case_parties', t.kind, CLIENT_KINDS),
    partyKindCheck('case_parties'),
    encPairCheck('case_parties'),
    encKeyCheck('case_parties'),
    fk('case_parties_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]).onDelete('cascade'),
    fk('case_parties_client_fk', [t.orgId, t.clientId], [clients.orgId, clients.id]).onDelete(
      'set null',
    ),
    fk('case_parties_pii_org_key_fk', [t.orgId, t.piiOrgKeyId], [orgKeys.orgId, orgKeys.id]),
    index('case_parties_case_idx').on(t.orgId, t.caseId, t.sortOrder),
    index('case_parties_client_idx').on(t.orgId, t.clientId).where(notNull('client_id')),
    index('case_parties_pii_key_idx').on(t.orgId, t.piiOrgKeyId).where(notNull('pii_org_key_id')),
  ],
);

/** Çıkarılmış metin + Evrak Kartı (1:1 `files`). */
export const fileTexts = appSchema.table(
  'file_texts',
  {
    fileId: uuid('file_id').primaryKey(),
    orgId: orgIdRef(),
    text: text('text').notNull(),
    tokenCount: integer('token_count').notNull(),
    pageCount: integer('page_count'),
    pageOffsets: integer('page_offsets').array(),
    ocrEngine: text('ocr_engine'),
    extractedAt: tstz('extracted_at'),
    extractionMethod: text('extraction_method').notNull(),
    language: text('language'),
    hiddenContentReport: jsonb('hidden_content_report').notNull().default(sql`'{}'::jsonb`),
    hasHiddenContent: boolean('has_hidden_content').notNull().default(false),
    docType: text('doc_type'),
    card: jsonb('card'),
    cardStatus: text('card_status').notNull().default('pending'),
    cardGeneratedAt: tstz('card_generated_at'),
    cardErrorCode: text('card_error_code'),
    extractorVersion: text('extractor_version').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('file_texts', t.extractionMethod, EXTRACTION_METHODS),
    inList('file_texts', t.docType, FILE_DOC_TYPES),
    inList('file_texts', t.cardStatus, FILE_CARD_STATUSES),
    fk('file_texts_file_fk', [t.orgId, t.fileId], [files.orgId, files.id]).onDelete('cascade'),
    index('file_texts_org_file_idx').on(t.orgId, t.fileId),
  ],
);

/** Evrak parçaları: büro içi tam tarama (HNSW ve BM25 YOK; 030 §1.5). */
export const fileChunks = appSchema.table(
  'file_chunks',
  {
    id: idV7(),
    orgId: orgIdRef(),
    fileId: uuid('file_id').notNull(),
    caseId: uuid('case_id'),
    chunkNo: integer('chunk_no').notNull(),
    pageFrom: integer('page_from'),
    pageTo: integer('page_to'),
    text: text('text').notNull(),
    textNorm: text('text_norm').notNull(),
    tsv: tsvector('tsv').generatedAlwaysAs(
      sql`to_tsvector('public.tr_hukuk'::regconfig, ${col('text_norm')})`,
    ),
    tokenCount: integer('token_count').notNull(),
    emb: halfvec('emb', { dimensions: 1024 }),
    embedModelRevision: text('embed_model_revision'),
    createdAt: createdAt(),
  },
  (t) => [
    check('file_chunks_chunk_no_chk', sql`${col('chunk_no')} >= 0`),
    unique('file_chunks_file_chunk_uq').on(t.orgId, t.fileId, t.chunkNo),
    fk('file_chunks_file_fk', [t.orgId, t.fileId], [files.orgId, files.id]).onDelete('cascade'),
    fk('file_chunks_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]),
    index('file_chunks_case_idx').on(t.orgId, t.caseId, t.fileId),
    index('file_chunks_tsv_idx').using('gin', t.tsv),
  ],
);

/** Delil zinciri (EKLİ; aylık RANGE bölüm; FK yok; 033). */
export const custodyEvents = appSchema.table(
  'custody_events',
  {
    id: idV7NoPk(),
    orgId: uuid('org_id').notNull(),
    fileId: uuid('file_id').notNull(),
    caseId: uuid('case_id'),
    event: text('event').notNull(),
    actorType: text('actor_type').notNull(),
    actorId: uuid('actor_id'),
    sha256: bytea('sha256'),
    ipTrunc: inet('ip_trunc'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'custody_events_pkey', columns: [t.id, t.createdAt] }),
    inList('custody_events', t.event, CUSTODY_EVENTS),
    inList('custody_events', t.actorType, AUDIT_ACTOR_TYPES),
    check(
      'custody_events_sha256_chk',
      sql`${col('sha256')} IS NULL OR octet_length(${col('sha256')}) = 32`,
    ),
    index('custody_events_file_idx').on(t.orgId, t.fileId, t.createdAt),
    index('custody_events_case_idx').on(t.orgId, t.caseId, t.createdAt).where(notNull('case_id')),
    index('custody_events_brin').using('brin', t.createdAt),
  ],
);

/** Dosya AI İşlem Kaydı (ekli davranış; FK yok). */
export const caseAiLogs = appSchema.table(
  'case_ai_logs',
  {
    id: idV7(),
    orgId: uuid('org_id').notNull(),
    caseId: uuid('case_id').notNull(),
    userId: uuid('user_id'),
    task: text('task').notNull(),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    documentId: uuid('document_id'),
    fileId: uuid('file_id'),
    modelAlias: text('model_alias').notNull(),
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    region: text('region').notNull(),
    dataClass: text('data_class').notNull(),
    maskedCount: integer('masked_count').notNull().default(0),
    credits: integer('credits').notNull().default(0),
    outcome: text('outcome').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    inList('case_ai_logs', t.task, AI_TASKS),
    inList('case_ai_logs', t.region, AI_PROVIDER_REGIONS),
    inList('case_ai_logs', t.dataClass, DATA_CLASSES),
    inList('case_ai_logs', t.outcome, CASE_AI_LOG_OUTCOMES),
    index('case_ai_logs_case_idx').on(t.orgId, t.caseId, t.createdAt.desc()),
  ],
);

/** Büro başı bekleyen dosya işleri (round-robin; 043 §6). */
export const pendingFileJobs = appSchema.table(
  'pending_file_jobs',
  {
    id: idV7(),
    orgId: orgIdRef(),
    fileId: uuid('file_id').notNull(),
    queue: text('queue').notNull(),
    jobName: text('job_name').notNull(),
    priority: smallint('priority').notNull().default(5),
    createdAt: createdAt(),
  },
  (t) => [
    inList('pending_file_jobs', t.queue, PENDING_FILE_QUEUES),
    inList('pending_file_jobs', t.jobName, PENDING_FILE_JOB_NAMES),
    unique('pending_file_jobs_file_uq').on(t.fileId),
    fk('pending_file_jobs_file_fk', [t.orgId, t.fileId], [files.orgId, files.id]).onDelete(
      'cascade',
    ),
    index('pending_file_jobs_rr_idx').on(t.orgId, t.priority, t.createdAt),
  ],
);

export type Client = typeof clients.$inferSelect;
export type LegalCase = typeof cases.$inferSelect;
export type CaseMember = typeof caseMembers.$inferSelect;
export type CaseParty = typeof caseParties.$inferSelect;
export type StoredFile = typeof files.$inferSelect;
export type PowerOfAttorney = typeof powersOfAttorney.$inferSelect;
export type FileText = typeof fileTexts.$inferSelect;
export type FileChunk = typeof fileChunks.$inferSelect;
export type CustodyEvent = typeof custodyEvents.$inferSelect;
export type CaseAiLog = typeof caseAiLogs.$inferSelect;
export type PendingFileJob = typeof pendingFileJobs.$inferSelect;
