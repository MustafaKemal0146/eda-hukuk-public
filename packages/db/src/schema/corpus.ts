// `corpus` şeması (030 §13): kamu korpusu, kiracısız, RLS YOK; `eda_app` SELECT, `eda_worker` DML
// (`DEFAULT PRIVILEGES`, 0000). HNSW ve BM25 indeksleri ayrı `index` migrasyonundadır (boş tabloda);
// `law_article_versions` EXCLUDE kısıtı ve `laws.title` harmanlaması migrasyonda yamadır.

import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  BREAKER_STATES,
  DECISION_ORIGINS,
  DECISION_SECTION_ROLES,
  DECISION_TEXT_STATUSES,
  DECISION_WITHDRAWN_REASONS,
  EMBED_STAGING_KINDS,
  INGESTION_RUN_KINDS,
  INGESTION_RUN_STATUSES,
  LAW_STATUSES,
  LAW_TYPES,
  SEARCH_COURT_TYPES,
  SOURCE_CANARY_OUTCOMES,
  SOURCE_CANARY_PROBES,
  SOURCE_CODES,
  SOURCE_STATES,
} from '@eda/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  halfvec,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList } from './_checks.ts';
import { col, createdAt, idV7, tstz, updatedAt } from './_columns.ts';
import { bytea, daterange, tsvector } from './_types.ts';

export const corpusSchema = pgSchema('corpus');

const SECTION_MAX = CONFIG_DEFAULTS['sources.decisionSectionMaxChars'];
const EMBED_DIMENSIONS = 1024;
const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const sha256Check = (table: string, column: string) =>
  check(`${table}_${column}_chk`, sql`${col(column)} IS NULL OR octet_length(${col(column)}) = 32`);
/** Türkçe karakter katlama bacağı (023 §3): `text_fold` ve `fold_tsv` üretilmiş kolonları. */
const foldExpr = sql`translate(${col('text_norm')}, 'çğıöşü', 'cgiosu')`;

export const ingestionRuns = corpusSchema.table(
  'ingestion_runs',
  {
    id: idV7(),
    kind: text('kind').notNull(),
    source: text('source'),
    status: text('status').notNull().default('running'),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    embedModelRevision: text('embed_model_revision'),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsInserted: integer('items_inserted').notNull().default(0),
    itemsUpdated: integer('items_updated').notNull().default(0),
    itemsFailed: integer('items_failed').notNull().default(0),
    errorSummary: jsonb('error_summary').notNull().default(sql`'{}'::jsonb`),
    startedAt: tstz('started_at').notNull().defaultNow(),
    finishedAt: tstz('finished_at'),
  },
  (t) => [
    inList('ingestion_runs', t.kind, INGESTION_RUN_KINDS),
    inList('ingestion_runs', t.status, INGESTION_RUN_STATUSES),
    index('ingestion_runs_kind_idx').on(t.kind, t.startedAt.desc()),
  ],
);

export const decisions = corpusSchema.table(
  'decisions',
  {
    id: idV7(),
    source: text('source').notNull(),
    documentId: text('document_id').notNull(),
    origin: text('origin').notNull(),
    courtName: text('court_name').notNull(),
    courtType: text('court_type').notNull(),
    courtCode: text('court_code'),
    chamberRaw: text('chamber_raw'),
    chamberCode: text('chamber_code'),
    esasNo: text('esas_no'),
    kararNo: text('karar_no'),
    decisionDate: date('decision_date', { mode: 'string' }),
    title: text('title'),
    kunyeNorm: text('kunye_norm').notNull(),
    kunyeFold: text('kunye_fold').notNull(),
    textStatus: text('text_status').notNull().default('full'),
    sectionCount: integer('section_count').notNull().default(0),
    citedArticles: jsonb('cited_articles').notNull().default(sql`'[]'::jsonb`),
    url: text('url'),
    contentSha256: bytea('content_sha256'),
    summary: text('summary'),
    summaryModel: text('summary_model'),
    summaryAt: tstz('summary_at'),
    kunyeHash: bytea('kunye_hash'),
    withdrawnAt: tstz('withdrawn_at'),
    withdrawnReason: text('withdrawn_reason'),
    sectioningVersion: integer('sectioning_version').notNull().default(1),
    chunkingVersion: integer('chunking_version').notNull().default(1),
    retrievedAt: tstz('retrieved_at').notNull(),
    ingestionRunId: uuid('ingestion_run_id').references(() => ingestionRuns.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('decisions', t.source, SOURCE_CODES),
    inList('decisions', t.origin, DECISION_ORIGINS),
    inList('decisions', t.courtType, SEARCH_COURT_TYPES),
    inList('decisions', t.textStatus, DECISION_TEXT_STATUSES),
    sha256Check('decisions', 'content_sha256'),
    sha256Check('decisions', 'kunye_hash'),
    inList('decisions', t.withdrawnReason, DECISION_WITHDRAWN_REASONS),
    unique('decisions_source_doc_uq').on(t.source, t.documentId),
    index('decisions_chamber_esas_idx').on(t.chamberCode, t.esasNo).where(notNull('esas_no')),
    index('decisions_chamber_karar_idx').on(t.chamberCode, t.kararNo).where(notNull('karar_no')),
    index('decisions_court_date_idx').on(t.courtCode, t.decisionDate.desc()),
    index('decisions_date_idx').on(t.decisionDate.desc()),
    index('decisions_kunye_trgm_idx').using('gin', t.kunyeFold.op('gin_trgm_ops')),
    index('decisions_cited_idx').using('gin', t.citedArticles.op('jsonb_path_ops')),
    index('decisions_run_idx').on(t.ingestionRunId).where(notNull('ingestion_run_id')),
    index('decisions_kunye_hash_idx').on(t.kunyeHash).where(notNull('kunye_hash')),
    index('decisions_court_type_date_idx').on(t.courtType, t.decisionDate.desc()),
  ],
);

export const decisionSections = corpusSchema.table(
  'decision_sections',
  {
    id: idV7(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    sectionNo: integer('section_no').notNull(),
    role: text('role').notNull(),
    heading: text('heading'),
    text: text('text').notNull(),
    textNorm: text('text_norm').notNull(),
    courtType: text('court_type').notNull(),
    chamberCode: text('chamber_code'),
    decisionDate: date('decision_date', { mode: 'string' }),
    textFold: text('text_fold').generatedAlwaysAs(foldExpr),
    foldTsv: tsvector('fold_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, ${foldExpr})`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    check('decision_sections_section_no_chk', sql`${col('section_no')} >= 1`),
    inList('decision_sections', t.role, DECISION_SECTION_ROLES),
    check(
      'decision_sections_text_chk',
      sql`char_length(${col('text')}) <= ${sql.raw(String(SECTION_MAX))}`,
    ),
    unique('decision_sections_uq').on(t.decisionId, t.sectionNo),
    index('decision_sections_fold_tsv_idx').using('gin', t.foldTsv),
  ],
);

export const decisionChunks = corpusSchema.table(
  'decision_chunks',
  {
    id: idV7(),
    decisionId: uuid('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => decisionSections.id, { onDelete: 'cascade' }),
    chunkNo: integer('chunk_no').notNull(),
    role: text('role').notNull(),
    text: text('text').notNull(),
    contextPrefix: text('context_prefix').notNull(),
    tokenCount: integer('token_count').notNull(),
    courtType: text('court_type').notNull(),
    chamberCode: text('chamber_code'),
    decisionDate: date('decision_date', { mode: 'string' }),
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    emb: halfvec('emb', { dimensions: EMBED_DIMENSIONS }),
    embedModelRevision: text('embed_model_revision'),
    createdAt: createdAt(),
  },
  (t) => [
    check('decision_chunks_chunk_no_chk', sql`${col('chunk_no')} >= 0`),
    unique('decision_chunks_uq').on(t.decisionId, t.chunkNo),
    index('decision_chunks_section_idx').on(t.sectionId),
    index('decision_chunks_filter_idx').on(t.courtType, t.decisionDate),
    index('decision_chunks_decision_idx').on(t.decisionId, t.sectionId, t.chunkNo),
    index('decision_chunks_pending_idx')
      .on(t.id)
      .where(sql`${col('emb')} IS NULL`),
  ],
);

export const laws = corpusSchema.table(
  'laws',
  {
    id: idV7(),
    lawType: text('law_type').notNull().default('law'),
    lawNo: text('law_no').notNull(),
    title: text('title').notNull(),
    titleFold: text('title_fold').notNull(),
    shortName: text('short_name'),
    aliases: text('aliases').array().notNull().default(sql`'{}'::text[]`),
    officialGazetteDate: date('official_gazette_date', { mode: 'string' }),
    officialGazetteNo: text('official_gazette_no'),
    acceptedDate: date('accepted_date', { mode: 'string' }),
    lastAmendedDate: date('last_amended_date', { mode: 'string' }),
    status: text('status').notNull().default('in_force'),
    sourceUrl: text('source_url'),
    contentSha256: bytea('content_sha256'),
    lastSnapshotAt: tstz('last_snapshot_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('laws', t.lawType, LAW_TYPES),
    inList('laws', t.status, LAW_STATUSES),
    unique('laws_type_no_uq').on(t.lawType, t.lawNo),
    index('laws_title_trgm_idx').using('gin', t.titleFold.op('gin_trgm_ops')),
  ],
);

export const lawArticles = corpusSchema.table(
  'law_articles',
  {
    id: idV7(),
    lawId: uuid('law_id')
      .notNull()
      .references(() => laws.id, { onDelete: 'cascade' }),
    articleNo: text('article_no').notNull(),
    title: text('title'),
    text: text('text').notNull(),
    textNorm: text('text_norm').notNull(),
    textFold: text('text_fold').generatedAlwaysAs(foldExpr),
    foldTsv: tsvector('fold_tsv').generatedAlwaysAs(
      sql`to_tsvector('simple'::regconfig, ${foldExpr})`,
    ),
    status: text('status').notNull().default('in_force'),
    amendedNote: text('amended_note'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'law_articles_article_no_chk',
      sql`${col('article_no')} ~ '^(G|E|M)?[0-9]+(/[A-Za-z])?$'`,
    ),
    inList('law_articles', t.status, LAW_STATUSES),
    unique('law_articles_uq').on(t.lawId, t.articleNo),
    index('law_articles_order_idx').on(t.lawId, t.sortOrder),
    index('law_articles_fold_tsv_idx').using('gin', t.foldTsv),
  ],
);

/** Yürürlük sürümleri; aynı maddede çakışan aralık EXCLUDE ile yasak (migrasyon yaması). */
export const lawArticleVersions = corpusSchema.table('law_article_versions', {
  id: idV7(),
  articleId: uuid('article_id')
    .notNull()
    .references(() => lawArticles.id, { onDelete: 'cascade' }),
  validDuring: daterange('valid_during').notNull(),
  text: text('text').notNull(),
  amendedBy: text('amended_by'),
  sourceSha256: bytea('source_sha256'),
  capturedAt: tstz('captured_at').notNull().defaultNow(),
  verifiedBy: text('verified_by'),
  verifiedAt: tstz('verified_at'),
});

export const lawArticleChunks = corpusSchema.table(
  'law_article_chunks',
  {
    id: idV7(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => lawArticles.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id').references(() => lawArticleVersions.id, {
      onDelete: 'cascade',
    }),
    chunkNo: integer('chunk_no').notNull(),
    text: text('text').notNull(),
    contextPrefix: text('context_prefix').notNull(),
    tokenCount: integer('token_count').notNull(),
    emb: halfvec('emb', { dimensions: EMBED_DIMENSIONS }),
    embedModelRevision: text('embed_model_revision'),
    createdAt: createdAt(),
  },
  (t) => [
    check('law_article_chunks_chunk_no_chk', sql`${col('chunk_no')} >= 0`),
    unique('law_article_chunks_uq').on(t.articleId, t.versionId, t.chunkNo).nullsNotDistinct(),
    index('law_article_chunks_version_idx').on(t.versionId).where(notNull('version_id')),
  ],
);

/** Toplu vektör yükleme sahnesi (034 §10.3; her yüklemeden sonra TRUNCATE). */
export const embedStaging = corpusSchema.table(
  'embed_staging',
  {
    chunkId: uuid('chunk_id').primaryKey(),
    kind: text('kind').notNull(),
    emb: halfvec('emb', { dimensions: EMBED_DIMENSIONS }).notNull(),
    embedModelRevision: text('embed_model_revision').notNull(),
  },
  (t) => [inList('embed_staging', t.kind, EMBED_STAGING_KINDS)],
);

/** Kaynak sağlığı anlık görüntüsü (021 §5.14). */
export const sourceStatus = corpusSchema.table(
  'source_status',
  {
    source: text('source').primaryKey(),
    liveEnabled: boolean('live_enabled').notNull().default(false),
    breakerState: text('breaker_state').notNull().default('closed'),
    lastSuccessAt: tstz('last_success_at'),
    lastErrorAt: tstz('last_error_at'),
    lastErrorCode: text('last_error_code'),
    p95Ms: integer('p95_ms'),
    state: text('state'),
    breakerOpenUntil: tstz('breaker_open_until'),
    bucketFillPct: integer('bucket_fill_pct'),
    waiting: jsonb('waiting').notNull().default(sql`'{}'::jsonb`),
    counters1h: jsonb('counters_1h').notNull().default(sql`'{}'::jsonb`),
    lastCanaryAt: tstz('last_canary_at'),
    lastCanaryOk: boolean('last_canary_ok'),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('source_status', t.source, SOURCE_CODES),
    inList('source_status', t.breakerState, BREAKER_STATES),
    inList('source_status', t.state, SOURCE_STATES),
    check('source_status_bucket_fill_pct_chk', sql`${col('bucket_fill_pct')} BETWEEN 0 AND 100`),
  ],
);

/**
 * `source_status.canary` yoklama sonuçları (021 §7.3; 002 §10.3). Sorgu metni ve yanıt içeriği tutulmaz;
 * yalnız yoklama kodu, sonuç, süre ve zaman. Saklama `sources.canaryWindowDays` (canary işi siler).
 */
export const sourceCanaryRuns = corpusSchema.table(
  'source_canary_runs',
  {
    id: idV7(),
    probe: text('probe').notNull(),
    outcome: text('outcome').notNull(),
    durationMs: integer('duration_ms').notNull(),
    checkedAt: tstz('checked_at').notNull().defaultNow(),
  },
  (t) => [
    inList('source_canary_runs', t.probe, SOURCE_CANARY_PROBES),
    inList('source_canary_runs', t.outcome, SOURCE_CANARY_OUTCOMES),
    check('source_canary_runs_duration_ms_chk', sql`${col('duration_ms')} >= 0`),
    index('source_canary_runs_probe_idx').on(t.probe, t.checkedAt.desc()),
  ],
);

export type IngestionRun = typeof ingestionRuns.$inferSelect;
export type Decision = typeof decisions.$inferSelect;
export type DecisionSection = typeof decisionSections.$inferSelect;
export type DecisionChunk = typeof decisionChunks.$inferSelect;
export type Law = typeof laws.$inferSelect;
export type LawArticle = typeof lawArticles.$inferSelect;
export type LawArticleVersion = typeof lawArticleVersions.$inferSelect;
export type LawArticleChunk = typeof lawArticleChunks.$inferSelect;
export type EmbedStaging = typeof embedStaging.$inferSelect;
export type SourceStatus = typeof sourceStatus.$inferSelect;
export type SourceCanaryRun = typeof sourceCanaryRuns.$inferSelect;
