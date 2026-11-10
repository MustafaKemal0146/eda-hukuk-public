// yargi-mcp ortak MCP tipleri (021 §5.4–§5.6). Alan adları snake_case; tarihler ISO 8601.
import { z } from 'zod';
import { CourtTypeSchema, IsoDate, SourceCode } from '../tools/common.ts';

/** MCP araç adları; `tools/list` bu sırayı deterministik verir (021 §5.1, KK-021-9). */
export const MCP_TOOL_NAMES = [
  'search_decisions',
  'get_decision',
  'search_legislation_live',
  'get_legislation_live',
  'source_status',
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** Desteklenen tek MCP protokol sürümü (021 §5.1; durumsuz, `initialize` yok). */
export const MCP_PROTOCOL_VERSION = '2026-07-28';

/** `_meta` anahtarları (021 Yeni Tanımlanan Adlar). */
export const MCP_META_PRIORITY = 'eda/priority';
export const MCP_META_CACHE_SCOPE = 'eda/cacheScope';
export const MCP_PRIORITIES = ['interactive', 'verify', 'ingest'] as const;
export type McpPriority = (typeof MCP_PRIORITIES)[number];
export const MCP_CACHE_SCOPES = ['shared', 'org'] as const;
export type McpCacheScope = (typeof MCP_CACHE_SCOPES)[number];

export const DECISION_LIVE_SOURCES = ['bedesten', 'anayasa', 'uyusmazlik'] as const;
export const DecisionLiveSource = z.enum(DECISION_LIVE_SOURCES);
export type DecisionLiveSourceCode = (typeof DECISION_LIVE_SOURCES)[number];

export const ChamberCode = z
  .string()
  .regex(
    /^(H([1-9]|1\d|2[0-3])|C([1-9]|1\d|2[0-3])|HGK|CGK|BGK|HBK|CBK|D([1-9]|1[0-7])|DBGK|IDDK|VDDK|IBK|IIK|DBK|AYIM|AYIMDK|AYIMB|AYIM[1-3])$/,
  );

export const FACET_KEYS = [
  'karar_turu',
  'kesinlesme',
  'basvuru_no',
  'hak',
  'mudahale_iddiasi',
  'sonuc',
  'giderim',
  'norm',
  'madde',
  'inceleme_sonuc',
  'dayanak',
  'bolum',
  'uyusmazlik_turu',
  'resmi_gazete',
] as const;
export const FacetKey = z.enum(FACET_KEYS);

export const MCP_ERROR_CODES = [
  'SOURCE_UNAVAILABLE',
  'SOURCE_BUSY',
  'SOURCE_RATE_LIMITED',
  'SOURCE_NOT_IN_COVERAGE',
  'SOURCE_DOCUMENT_NOT_FOUND',
  'SOURCE_PII_BLOCKED',
  'VALIDATION_FAILED',
] as const;
export type McpErrorCode = (typeof MCP_ERROR_CODES)[number];

export const MCP_ERROR_REASONS = [
  'timeout',
  'network',
  'upstream_5xx',
  'upstream_4xx',
  'parse_error',
  'breaker_open',
  'waf_blocked',
  'limiter_unavailable',
  'queue_wait_exceeded',
  'source_disabled',
  'invalid_document_id',
  'invalid_arguments',
] as const;
export type McpErrorReason = (typeof MCP_ERROR_REASONS)[number];

export const McpToolError = z
  .object({
    error: z
      .object({
        code: z.enum(MCP_ERROR_CODES),
        reason: z.enum(MCP_ERROR_REASONS).nullable(),
        retry_after_ms: z.number().int().nullable(),
        source: SourceCode.nullable(),
      })
      .strict(),
  })
  .strict();
export type McpToolErrorBody = z.infer<typeof McpToolError>;

/** 021 §5.5 normalize karar sonucu. */
export const NormalizedDecision = z
  .object({
    source: SourceCode,
    document_id: z.string(),
    court_type: CourtTypeSchema,
    court: z.string(),
    chamber: z.string().nullable(),
    chamber_code: ChamberCode.nullable(),
    esas_no: z.string().nullable(),
    karar_no: z.string().nullable(),
    decision_date: IsoDate.nullable(),
    title: z.string(),
    snippet: z.string().max(300).nullable(),
    url: z.string().url(),
    retrieved_at: IsoDate,
    origin: z.enum(['live', 'corpus']),
    facets: z.array(z.object({ key: FacetKey, value: z.string().max(300) }).strict()).nullable(),
  })
  .strict();
export type NormalizedDecisionValue = z.infer<typeof NormalizedDecision>;

export const SEARCH_WARNINGS = [
  'date_filter_partial',
  'pagination_unsupported',
  'chamber_ignored',
  'esas_postfiltered',
  'results_truncated',
] as const;
