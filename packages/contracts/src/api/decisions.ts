// Karar Arşivi HTTP sözleşmeleri (041 §2.4, §5.2; 053-04 §10, §12; P16.2). Alan adları camelCase.
// Yerel korpus (P14) ve kalıcı arama kaydı (P03) gelene dek eklenen alanlar 'de listelenir.
import { z } from 'zod';
import { CONFIG_DEFAULTS } from '../config/defaults.ts';
import {
  DECISION_SECTION_ROLES,
  LIVE_REASONS,
  LIVE_SEARCH_STATUSES,
  SEARCH_COURT_TYPES,
  SEARCH_OVERVIEW_STATUSES,
  SOURCE_CODES,
} from '../enums.ts';
import { DECISION_LIVE_SOURCES, type DecisionLiveSourceCode, FACET_KEYS } from '../mcp/common.ts';

const IsoDay = z.iso.date();

/** 023 §4.8 mahkeme türleri (002 §11 `SEARCH_COURT_TYPES`). */
export const CourtType = z.enum(SEARCH_COURT_TYPES);
export type CourtTypeValue = z.infer<typeof CourtType>;

/**
 * Sayfa boyutu: 053-04 §4.8 başlangıç değeri (P16.1 `retrieval.archivePageSize` 002'ye henüz
 * işlenmedi). Havuz üst sınırı `retrieval.archivePoolMax`.
 */
export const ARCHIVE_PAGE_SIZE = 20;
export const ARCHIVE_POOL_MAX = CONFIG_DEFAULTS['retrieval.archivePoolMax'];
export const ARCHIVE_MAX_PAGES = Math.ceil(ARCHIVE_POOL_MAX / ARCHIVE_PAGE_SIZE);

/** Daire süzgeci yalnız bu mahkeme türleri seçiliyken geçerlidir (041 §5.2). */
export const CHAMBER_COURT_TYPES = ['yargitay', 'kyb', 'danistay'] as const;

/**
 * Arşiv süzgecinde sunulan daire kodları: `@eda/contracts/mcp` `ChamberCode` deseninin Yargıtay ve
 * Danıştay daire/kurul alt kümesi.
 */
const range = (prefix: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
export const ARCHIVE_CHAMBER_CODES = {
  yargitay: [...range('H', 23), ...range('C', 23), 'HGK', 'CGK'],
  danistay: [...range('D', 17), 'IDDK', 'VDDK'],
} as const satisfies Record<'yargitay' | 'danistay', readonly string[]>;

export const CorpusFilters = z.strictObject({
  courtTypes: z.array(CourtType).min(1).max(SEARCH_COURT_TYPES.length).nullable(),
  // MCP tek daire kabul eder (021 §5.4); birden çok daire gereği reddedilir.
  chamberCodes: z
    .array(z.string().regex(/^[A-Z0-9]{1,8}$/))
    .min(1)
    .max(1)
    .nullable(),
  dateFrom: IsoDay.nullable(),
  dateTo: IsoDay.nullable(),
});
export type CorpusFiltersValue = z.infer<typeof CorpusFilters>;

export const DecisionSearchRequest = z.strictObject({
  query: z.string().trim().min(2).max(20000),
  filters: CorpusFilters,
});
export type DecisionSearchRequestValue = z.infer<typeof DecisionSearchRequest>;

/** URL `siralama` ↔ API `sort` (053-04 §1). */
export const SEARCH_SORTS = ['relevance', 'date_desc', 'date_asc'] as const;
export const SearchSortQuery = z.enum(SEARCH_SORTS);
export type SearchSort = z.infer<typeof SearchSortQuery>;

/** `GET …/searches/:searchId?page&limit&sort` (053-04 §4.8; 041 §1.3 istisnası). */
export const SearchPageQuery = z.strictObject({
  page: z.coerce.number().int().min(1).max(ARCHIVE_MAX_PAGES).default(1),
  limit: z.coerce.number().int().min(1).max(ARCHIVE_PAGE_SIZE).default(ARCHIVE_PAGE_SIZE),
  sort: SearchSortQuery.default('relevance'),
});
export type SearchPageQueryValue = z.infer<typeof SearchPageQuery>;

/** `POST …/live` isteğe bağlı gövdesi: `more` yalnız kullanıcı "sonraki canlı sonuçlar"ı isterse. */
export const LiveSearchRequest = z.strictObject({ more: z.boolean().default(false) });
export type LiveSearchRequestValue = z.infer<typeof LiveSearchRequest>;

export const Highlight = z.strictObject({
  start: z.number().int().min(0),
  end: z.number().int().min(0),
});

export const CitedArticle = z.strictObject({
  lawNo: z.string(),
  articleNo: z.string(),
  label: z.string(),
});

export const DECISION_HIT_TEXT_STATUSES = ['full', 'unavailable', 'unknown'] as const;

export const DecisionHitDto = z.strictObject({
  /** uuid VEYA `live_<source>_<base64url(documentId)>`. */
  decisionId: z.string().min(1).max(400),
  source: z.enum(SOURCE_CODES),
  origin: z.enum(['corpus', 'live']),
  court: z.string(),
  chamber: z.string().nullable(),
  esasNo: z.string().nullable(),
  kararNo: z.string().nullable(),
  decisionDate: IsoDay.nullable(),
  /** Sunucuda kayıttan biçimlenir; model yazmaz. */
  shortKunye: z.string(),
  title: z.string().nullable(),
  snippet: z.string().max(300).nullable(),
  highlights: z.array(Highlight),
  /** Yüzde yok; canlı sonuçta puan bulunmadığından `null`. */
  relevance: z.enum(['high', 'medium']).nullable(),
  url: z.string().url().nullable(),
  retrievedAt: IsoDay.nullable(),
  citedArticles: z.array(CitedArticle).max(5),
  hasDissent: z.boolean(),
  textStatus: z.enum(DECISION_HIT_TEXT_STATUSES),
});
export type DecisionHitDtoValue = z.infer<typeof DecisionHitDto>;

/** Kaynak başına canlı arama sonucu. */
export const LIVE_SOURCE_STATUSES = [
  'done',
  'stale',
  'not_in_coverage',
  'busy',
  'rate_limited',
  'unavailable',
] as const;
export const LiveSourceState = z.strictObject({
  source: z.enum(DECISION_LIVE_SOURCES),
  status: z.enum(LIVE_SOURCE_STATUSES),
  retryAfterSec: z.number().int().min(0).nullable(),
  resultCount: z.number().int().min(0),
  hasMore: z.boolean(),
});
export type LiveSourceStateValue = z.infer<typeof LiveSourceState>;

export const ModelBadge = z.strictObject({
  alias: z.string(),
  providerId: z.string(),
  region: z.string(),
  modelLabel: z.string(),
});

export const SearchOverviewSource = z.strictObject({
  ref: z.string().regex(/^K[1-9][0-9]?$/),
  decisionId: z.string(),
  shortKunye: z.string(),
});

export const SearchResultsDto = z.strictObject({
  searchId: z.uuid(),
  query: z.string(),
  filters: CorpusFilters,
  items: z.array(DecisionHitDto).max(ARCHIVE_PAGE_SIZE),
  nextCursor: z.string().nullable(),
  empty: z.boolean(),
  degraded: z.boolean(),
  liveReasons: z.array(z.enum(LIVE_REASONS)),
  live: z.strictObject({
    available: z.boolean(),
    requested: z.boolean(),
    status: z.enum(LIVE_SEARCH_STATUSES),
    staleAsOf: IsoDay.nullable(),
    sources: z.array(LiveSourceState),
    /** Bir kaynakta sonraki canlı sayfa var mı (yalnız kullanıcı isteğiyle getirilir). */
    hasMore: z.boolean(),
  }),
  /** Yerel korpus (P14) bağlı mı; değilse yerel sonuç bölümü boştur. */
  localCorpus: z.strictObject({ available: z.boolean() }),
  overview: z.strictObject({
    status: z.enum(SEARCH_OVERVIEW_STATUSES),
    text: z.string().nullable(),
    generatedAt: z.iso.datetime().nullable(),
    badge: ModelBadge.nullable(),
    sources: z.array(SearchOverviewSource),
  }),
  rerank: z.strictObject({
    available: z.boolean(),
    status: z.enum(['none', 'queued', 'done', 'failed']),
  }),
  pagination: z.strictObject({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    pageCount: z.number().int().min(0),
    total: z.number().int().min(0),
  }),
  sort: SearchSortQuery,
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type SearchResultsDtoValue = z.infer<typeof SearchResultsDto>;

export const DecisionSectionRoleDto = z.enum(DECISION_SECTION_ROLES);

export const DecisionSectionMeta = z.strictObject({
  sectionNo: z.number().int().min(1),
  role: DecisionSectionRoleDto,
  heading: z.string().nullable(),
  charCount: z.number().int().min(0),
});

export const DecisionDto = z.strictObject({
  decisionId: z.string().min(1).max(400),
  canonicalDecisionId: z.uuid().nullable(),
  source: z.enum(SOURCE_CODES),
  origin: z.enum(['corpus', 'live']),
  court: z.string(),
  chamber: z.string().nullable(),
  esasNo: z.string().nullable(),
  kararNo: z.string().nullable(),
  decisionDate: IsoDay.nullable(),
  shortKunye: z.string(),
  /** Panoya "Tam künyeyi kopyala" metni; sunucu kayıttan biçimler. */
  fullKunye: z.string(),
  title: z.string().nullable(),
  textStatus: z.enum(['full', 'unavailable']),
  sectionCount: z.number().int().min(0),
  sections: z.array(DecisionSectionMeta),
  citedArticles: z.array(CitedArticle),
  facets: z.array(z.strictObject({ key: z.enum(FACET_KEYS), value: z.string() })).nullable(),
  url: z.string().url().nullable(),
  aiSummary: z
    .strictObject({ text: z.string(), badge: ModelBadge, generatedAt: z.iso.datetime() })
    .nullable(),
  retrievedAt: IsoDay,
  /** Kaynak uyarıları (021 §5.4 `get_decision` `warnings`; eki). */
  warnings: z.array(z.enum(['truncated_max_chars', 'metadata_partial'])),
});
export type DecisionDtoValue = z.infer<typeof DecisionDto>;

export const SectionDto = z.strictObject({
  sectionNo: z.number().int().min(1),
  role: DecisionSectionRoleDto,
  heading: z.string().nullable(),
  text: z.string().max(CONFIG_DEFAULTS['sources.decisionSectionMaxChars']),
  charCount: z.number().int().min(0),
});
export type SectionDtoValue = z.infer<typeof SectionDto>;

// -- Canlı karar kimliği (053-04 §12 son satır) ---------------------------------------

const LIVE_ID = /^live_(bedesten|anayasa|uyusmazlik)_([A-Za-z0-9_-]{1,380})$/;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(enc: string): string | null {
  try {
    const bin = atob(enc.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** `live_<source>_<base64url(documentId)>`: AYM kimlikleri `/` içerdiğinden yol parçası güvenli kodlanır. */
export function encodeLiveDecisionId(source: DecisionLiveSourceCode, documentId: string): string {
  return `live_${source}_${toBase64Url(documentId)}`;
}

export function decodeLiveDecisionId(
  decisionId: string,
): { source: DecisionLiveSourceCode; documentId: string } | null {
  const m = LIVE_ID.exec(decisionId);
  if (!m) return null;
  const documentId = fromBase64Url(m[2] ?? '');
  if (documentId === null || documentId.length === 0 || documentId.length > 200) return null;
  return { source: m[1] as DecisionLiveSourceCode, documentId };
}
