// `app` AI işletimi (030 §10). Sağlayıcı/model/rota kataloğu (RLS K) seed ile yazılır; model kimliği
// koda yazılmaz (Y-96). `ai_usage` EKLİ ve aylık RANGE bölümlüdür (migrasyon yaması).
import {
  AI_POLICY_ACCEPTANCE_KINDS,
  AI_PROVIDER_KINDS,
  AI_PROVIDER_REGIONS,
  AI_TASKS,
  AI_USAGE_FLAGS,
  AI_USAGE_STATUSES,
  ALIAS_SOURCES,
  CREDIT_OP_CODES,
  DATA_CLASSES,
  PRICING_WINDOWS,
  THINKING_LEVELS,
  TOOL_CALL_NAMES,
  TOOL_CALL_STATUSES,
  TOOL_SETS,
  TRANSFER_BASES,
  USAGE_SOURCES,
} from '@eda/contracts/enums';
import { MODEL_ALIASES } from '@eda/contracts/stream';
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
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { arraySubset, col, createdAt, idV7, idV7NoPk, tstz, updatedAt } from '../_columns.ts';
import { bytea } from '../_types.ts';
import { organizations, users } from '../auth.ts';
import { appSchema } from './partners.ts';

const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const sha256Check = (table: string, column: string, nullable: boolean) =>
  check(
    `${table}_${column}_chk`,
    nullable
      ? sql`${col(column)} IS NULL OR octet_length(${col(column)}) = 32`
      : sql`octet_length(${col(column)}) = 32`,
  );
const ONLY_PUBLIC = sql`${col('allowed_data_classes')} <@ ARRAY[${sqlValueList(['public'])}]::text[]`;

/** Sağlayıcı kaydı; izin kolonları yalnız seed migrasyonu + CODEOWNERS (CHECK savunma derinliği). */
export const aiProviders = appSchema.table(
  'ai_providers',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    displayName: text('display_name').notNull(),
    region: text('region').notNull(),
    transferBasis: text('transfer_basis'),
    allowedDataClasses: text('allowed_data_classes')
      .array()
      .notNull()
      .default(sql`'{public}'::text[]`),
    secretRef: text('secret_ref'),
    baseUrl: text('base_url'),
    trainingUse: boolean('training_use').notNull().default(true),
    humanReview: boolean('human_review').notNull().default(true),
    retentionDays: integer('retention_days'),
    abuseMonitoringExemptionRef: text('abuse_monitoring_exemption_ref'),
    dpaRef: text('dpa_ref'),
    sccNotifiedAt: tstz('scc_notified_at'),
    clientAccessFrom: tstz('client_access_from'),
    enabled: boolean('enabled').notNull().default(false),
    priority: integer('priority').notNull().default(100),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('ai_providers_id_chk', sql`${col('id')} ~ '^[a-z0-9-]{2,32}$'`),
    inList('ai_providers', t.kind, AI_PROVIDER_KINDS),
    inList('ai_providers', t.region, AI_PROVIDER_REGIONS),
    inList('ai_providers', t.transferBasis, TRANSFER_BASES),
    arraySubset('ai_providers', t.allowedDataClasses, DATA_CLASSES),
    check(
      'ai_providers_mock_chk',
      sql`(${col('kind')} = 'mock') = (${col('region')} = 'NONE') AND ((${col('kind')} = 'mock') = (${col('transfer_basis')} IS NULL))`,
    ),
    check(
      'ai_providers_class_basis_chk',
      sql`${col('kind')} = 'mock' OR ${ONLY_PUBLIC} OR ${col('transfer_basis')} IN (${sqlValueList(['domestic', 'scc_notified'])})`,
    ),
    check(
      'ai_providers_class_terms_chk',
      sql`${col('kind')} = 'mock' OR ${ONLY_PUBLIC} OR (NOT ${col('training_use')} AND NOT ${col('human_review')} AND ${col('retention_days')} <= 30)`,
    ),
    check(
      'ai_providers_scc_chk',
      sql`${col('transfer_basis')} IS DISTINCT FROM 'scc_notified' OR ${col('scc_notified_at')} IS NOT NULL`,
    ),
  ],
);

/** Model kaydı (takma ad -> sağlayıcı modeli); fiyatlar mikro-USD / 1M token. */
export const aiModels = appSchema.table(
  'ai_models',
  {
    id: idV7(),
    alias: text('alias').notNull(),
    providerId: text('provider_id')
      .notNull()
      .references(() => aiProviders.id),
    modelId: text('model_id').notNull(),
    label: text('label').notNull(),
    cacheHitOffpeakMicroUsdPerMtok: bigint('cache_hit_offpeak_micro_usd_per_mtok', {
      mode: 'number',
    })
      .notNull()
      .default(0),
    cacheHitPeakMicroUsdPerMtok: bigint('cache_hit_peak_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    inputOffpeakMicroUsdPerMtok: bigint('input_offpeak_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    inputPeakMicroUsdPerMtok: bigint('input_peak_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    outputOffpeakMicroUsdPerMtok: bigint('output_offpeak_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    outputPeakMicroUsdPerMtok: bigint('output_peak_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    cacheWriteMicroUsdPerMtok: bigint('cache_write_micro_usd_per_mtok', { mode: 'number' })
      .notNull()
      .default(0),
    peakSchedule: jsonb('peak_schedule'),
    contextBudget: integer('context_budget').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    thinking: text('thinking').notNull().default('off'),
    capabilities: jsonb('capabilities').notNull(),
    priority: integer('priority').notNull().default(100),
    enabled: boolean('enabled').notNull().default(false),
    evalGatePassedAt: tstz('eval_gate_passed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('ai_models', t.alias, MODEL_ALIASES),
    check('ai_models_context_budget_chk', sql`${col('context_budget')} > 0`),
    check('ai_models_max_output_tokens_chk', sql`${col('max_output_tokens')} > 0`),
    inList('ai_models', t.thinking, THINKING_LEVELS),
    unique('ai_models_uq').on(t.alias, t.providerId, t.modelId),
    index('ai_models_resolve_idx')
      .on(t.alias, t.priority)
      .where(sql`${col('enabled')}`),
  ],
);

/** Görev -> takma ad/araç seti; sınıf kuralı ve izinli takma adlar `task-policy.ts`'tedir (020 §5.1). */
export const aiTaskRoutes = appSchema.table(
  'ai_task_routes',
  {
    task: text('task').primaryKey(),
    aliasSource: text('alias_source').notNull(),
    defaultAlias: text('default_alias'),
    thinkingOverride: text('thinking_override'),
    toolSet: text('tool_set').notNull(),
    creditOpCode: text('credit_op_code'),
    maxOutputTokens: integer('max_output_tokens'),
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('ai_task_routes', t.task, AI_TASKS),
    inList('ai_task_routes', t.aliasSource, ALIAS_SOURCES),
    inList('ai_task_routes', t.defaultAlias, MODEL_ALIASES),
    inList('ai_task_routes', t.thinkingOverride, THINKING_LEVELS),
    inList('ai_task_routes', t.toolSet, TOOL_SETS),
    inList('ai_task_routes', t.creditOpCode, CREDIT_OP_CODES),
    check(
      'ai_task_routes_alias_chk',
      sql`(${col('alias_source')} = 'local_engine') = (${col('default_alias')} IS NULL)`,
    ),
    index('ai_task_routes_updated_by_idx').on(t.updatedBy).where(notNull('updated_by')),
  ],
);

/** Çağrı başı kullanım ve maliyet (EKLİ; aylık bölüm; FK yok; maliyet çağrı anında sabitlenir). */
export const aiUsage = appSchema.table(
  'ai_usage',
  {
    id: idV7NoPk(),
    orgId: uuid('org_id'),
    userId: uuid('user_id'),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    caseId: uuid('case_id'),
    documentId: uuid('document_id'),
    fileId: uuid('file_id'),
    reservationId: uuid('reservation_id'),
    task: text('task').notNull(),
    opCode: text('op_code'),
    modelAlias: text('model_alias').notNull(),
    providerId: text('provider_id').notNull(),
    aiModelId: uuid('ai_model_id'),
    modelId: text('model_id').notNull(),
    region: text('region').notNull(),
    dataClass: text('data_class').notNull(),
    thinking: text('thinking').notNull(),
    stepNo: smallint('step_no').notNull().default(0),
    attemptNo: smallint('attempt_no').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    usageSource: text('usage_source').notNull().default('provider'),
    pricingWindow: text('pricing_window').notNull(),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    ttftMs: integer('ttft_ms'),
    latencyMs: integer('latency_ms'),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    finishReason: text('finish_reason'),
    fallbackFromProviderId: text('fallback_from_provider_id'),
    prefixHash: text('prefix_hash'),
    promptVersionId: uuid('prompt_version_id'),
    flags: text('flags').array().notNull().default(sql`'{}'::text[]`),
    requestId: text('request_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ name: 'ai_usage_pkey', columns: [t.id, t.createdAt] }),
    inList('ai_usage', t.task, AI_TASKS),
    inList('ai_usage', t.region, AI_PROVIDER_REGIONS),
    inList('ai_usage', t.dataClass, DATA_CLASSES),
    inList('ai_usage', t.thinking, THINKING_LEVELS),
    inList('ai_usage', t.usageSource, USAGE_SOURCES),
    inList('ai_usage', t.pricingWindow, PRICING_WINDOWS),
    inList('ai_usage', t.status, AI_USAGE_STATUSES),
    arraySubset('ai_usage', t.flags, AI_USAGE_FLAGS),
    index('ai_usage_reservation_idx').on(t.reservationId).where(notNull('reservation_id')),
    index('ai_usage_org_idx').on(t.orgId, t.createdAt.desc()),
    index('ai_usage_conv_idx').on(t.orgId, t.conversationId).where(notNull('conversation_id')),
    index('ai_usage_brin').using('brin', t.createdAt),
  ],
);

/** Araç çağrısı metrikleri (ad, süre, durum; argüman/içerik YOK; ekli; FK yok). */
export const toolCalls = appSchema.table(
  'tool_calls',
  {
    id: idV7(),
    orgId: uuid('org_id').notNull(),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    toolName: text('tool_name').notNull(),
    status: text('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    resultTokens: integer('result_tokens'),
    live: boolean('live').notNull().default(false),
    source: text('source'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
  },
  (t) => [
    inList('tool_calls', t.toolName, TOOL_CALL_NAMES),
    inList('tool_calls', t.status, TOOL_CALL_STATUSES),
    index('tool_calls_org_idx').on(t.orgId, t.createdAt.desc()),
    index('tool_calls_brin').using('brin', t.createdAt),
  ],
);

/**
 * Platform ortak anahtarıyla yapılan sohbet turları: kullanıcı, büro, token
 * sayıları, tahmini maliyet ve durum. Günlük kullanıcı/büro sınırı `app.platform_key_usage_today()` ile
 * okunur; yalnız `PLATFORM_AI_KEY_FALLBACK=true` iken yazılır. FK yok (tool_calls gibi).
 */
export const platformKeyUsage = appSchema.table(
  'platform_key_usage',
  {
    id: idV7(),
    orgId: uuid('org_id').notNull(),
    userId: uuid('user_id').notNull(),
    conversationId: uuid('conversation_id'),
    modelAlias: text('model_alias').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }).notNull().default(0),
    status: text('status').notNull(),
    requestId: text('request_id'),
    /**
     * Atomik kota rezervasyonu (0050): `open` = tur sürüyor (satır `status='stopped'` yer tutucusuyla
     * sayılır), `released` = kullanılmayan rezervasyon iadesi (hiçbir sayaca girmez), NULL = kapanmış
     * normal kayıt. Değerleri yalnız `app.platform_key_reserve/settle` yazar.
     */
    reservation: text('reservation'),
    createdAt: createdAt(),
  },
  (t) => [
    inList('platform_key_usage', t.status, AI_USAGE_STATUSES),
    inList('platform_key_usage', t.modelAlias, MODEL_ALIASES),
    check(
      'platform_key_usage_tokens_chk',
      sql`${col('input_tokens')} >= 0 AND ${col('output_tokens')} >= 0`,
    ),
    check('platform_key_usage_cost_chk', sql`${col('cost_micro_usd')} >= 0`),
    index('platform_key_usage_user_idx').on(t.userId, t.createdAt.desc()),
    index('platform_key_usage_org_idx').on(t.orgId, t.createdAt.desc()),
  ],
);

/**
 * Platform ayarı: TEK satırlı (`id` sabit `true`). Yönetimden girilen platform ortak Anthropic
 * anahtarı KEK'ten türetilen anahtarla şifreli saklanır (`key_enc`; AAD `platform_settings` /
 * `platform_ai_key` + `key_version` = KEK sürümü); görünen ad `key_label` ve `key_last4` yalnız kart içindir.
 * `fallback_enabled` yumuşak düşüş anahtarıdır (env `PLATFORM_AI_KEY_FALLBACK` sert kapıdır). Limit
 * kolonlarında `NULL` = yapılandırma zinciri (`platformKey.*`, `costGuard.*`). Okuma ve yazma yalnız
 * `app.admin_platform_*` / `app.platform_settings_runtime()` fonksiyonlarıyla; uygulama rolleri erişemez.
 */
export const platformSettings = appSchema.table(
  'platform_settings',
  {
    id: boolean('id').primaryKey().notNull().default(true),
    keyEnc: bytea('key_enc'),
    keyVersion: integer('key_version'),
    keyLabel: text('key_label'),
    keyLast4: text('key_last4'),
    keyVerifiedAt: tstz('key_verified_at'),
    fallbackEnabled: boolean('fallback_enabled').notNull().default(true),
    userTurnsPerDay: integer('user_turns_per_day'),
    userTokensPerDay: bigint('user_tokens_per_day', { mode: 'number' }),
    orgDailyCapMicroUsd: bigint('org_daily_cap_micro_usd', { mode: 'number' }),
    platformDailyCapMicroUsd: bigint('platform_daily_cap_micro_usd', { mode: 'number' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('platform_settings_singleton_chk', sql`${col('id')}`),
    check(
      'platform_settings_key_chk',
      sql`(${col('key_enc')} IS NULL) = (${col('key_last4')} IS NULL) AND (${col('key_enc')} IS NULL) = (${col('key_version')} IS NULL) AND (${col('key_enc')} IS NULL) = (${col('key_label')} IS NULL) AND (${col('key_enc')} IS NULL) = (${col('key_verified_at')} IS NULL)`,
    ),
    check(
      'platform_settings_label_chk',
      sql`${col('key_label')} IS NULL OR (char_length(${col('key_label')}) BETWEEN 3 AND 60 AND ${col('key_label')} !~ '[[:cntrl:]<>]')`,
    ),
    check(
      'platform_settings_limits_chk',
      sql`(${col('user_turns_per_day')} IS NULL OR ${col('user_turns_per_day')} BETWEEN 1 AND 10000) AND (${col('user_tokens_per_day')} IS NULL OR ${col('user_tokens_per_day')} BETWEEN 1000 AND 100000000) AND (${col('org_daily_cap_micro_usd')} IS NULL OR ${col('org_daily_cap_micro_usd')} BETWEEN 100000 AND 10000000000)`,
    ),
    check(
      'platform_settings_platform_cap_chk',
      sql`${col('platform_daily_cap_micro_usd')} IS NULL OR ${col('platform_daily_cap_micro_usd')} BETWEEN 1000000 AND 100000000000`,
    ),
    index('platform_settings_updated_by_idx')
      .on(t.updatedBy)
      .where(sql`${col('updated_by')} IS NOT NULL`),
  ],
);

/** Eval sonuçları (RLS K; yalnız CI ve admin fonksiyonları). */
export const evalRuns = appSchema.table(
  'eval_runs',
  {
    id: idV7(),
    suite: text('suite').notNull(),
    gate: text('gate'),
    target: jsonb('target').notNull(),
    gitSha: text('git_sha').notNull(),
    datasetSha256: bytea('dataset_sha256'),
    metrics: jsonb('metrics').notNull(),
    passed: boolean('passed').notNull(),
    startedAt: tstz('started_at').notNull(),
    finishedAt: tstz('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('eval_runs_git_sha_chk', sql`${col('git_sha')} ~ '^[0-9a-f]{7,40}$'`),
    index('eval_runs_suite_idx').on(t.suite, t.createdAt.desc()),
  ],
);

/** Sürümlü sistem direktifleri (024 §11); gövde değişmez, yeni sürüm eklenir. */
export const promptVersions = appSchema.table(
  'prompt_versions',
  {
    id: idV7(),
    promptKey: text('prompt_key').notNull(),
    version: integer('version').notNull(),
    body: text('body').notNull(),
    sha256: bytea('sha256').notNull(),
    lockedSha256: bytea('locked_sha256'),
    tokenCount: integer('token_count').notNull(),
    variables: text('variables').array().notNull().default(sql`'{}'::text[]`),
    isActive: boolean('is_active').notNull().default(false),
    activatedAt: tstz('activated_at'),
    activatedBy: uuid('activated_by').references(() => users.id, { onDelete: 'set null' }),
    retiredAt: tstz('retired_at'),
    evalRunId: uuid('eval_run_id').references(() => evalRuns.id, { onDelete: 'set null' }),
    legalReviewBy: text('legal_review_by'),
    legalReviewAt: date('legal_review_at', { mode: 'string' }),
    changeNote: text('change_note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    check('prompt_versions_prompt_key_chk', sql`${col('prompt_key')} ~ '^[a-z0-9_.]{3,64}$'`),
    check('prompt_versions_version_chk', sql`${col('version')} >= 1`),
    sha256Check('prompt_versions', 'sha256', false),
    sha256Check('prompt_versions', 'locked_sha256', true),
    unique('prompt_versions_uq').on(t.promptKey, t.version),
    unique('prompt_versions_sha_uq').on(t.promptKey, t.sha256),
    check(
      'prompt_versions_state_chk',
      sql`NOT (${col('is_active')} AND ${col('retired_at')} IS NOT NULL)`,
    ),
    uniqueIndex('prompt_versions_active_uq')
      .on(t.promptKey)
      .where(sql`${col('is_active')}`),
    index('prompt_versions_activated_by_idx').on(t.activatedBy).where(notNull('activated_by')),
    index('prompt_versions_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Büro AI politikası ve yetkilendirme kabulleri (yalnız ekleme + iptal alanları). */
export const aiPolicyAcceptances = appSchema.table(
  'ai_policy_acceptances',
  {
    id: idV7(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => organizations.id),
    kind: text('kind').notNull(),
    policyVersion: text('policy_version').notNull(),
    textSha256: bytea('text_sha256').notNull(),
    providerId: text('provider_id').references(() => aiProviders.id),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    acceptedAt: tstz('accepted_at').notNull().defaultNow(),
    ipTrunc: inet('ip_trunc'),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: tstz('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [
    inList('ai_policy_acceptances', t.kind, AI_POLICY_ACCEPTANCE_KINDS),
    sha256Check('ai_policy_acceptances', 'text_sha256', false),
    index('ai_policy_acceptances_idx').on(t.orgId, t.kind, t.acceptedAt.desc()),
    index('ai_policy_acceptances_accepted_by_idx').on(t.acceptedBy).where(notNull('accepted_by')),
    index('ai_policy_acceptances_revoked_by_idx').on(t.revokedBy).where(notNull('revoked_by')),
  ],
);

export type AiProvider = typeof aiProviders.$inferSelect;
export type AiModel = typeof aiModels.$inferSelect;
export type AiTaskRoute = typeof aiTaskRoutes.$inferSelect;
export type AiUsage = typeof aiUsage.$inferSelect;
export type PlatformKeyUsage = typeof platformKeyUsage.$inferSelect;
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type ToolCall = typeof toolCalls.$inferSelect;
export type EvalRun = typeof evalRuns.$inferSelect;
export type PromptVersion = typeof promptVersions.$inferSelect;
export type AiPolicyAcceptance = typeof aiPolicyAcceptances.$inferSelect;
