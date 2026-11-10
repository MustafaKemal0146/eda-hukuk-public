// Karar Arşivi ve Mevzuat uçlarının tarayıcı istemcisi (aynı origin `/api/v1/*`; 002 §15). Sorgu metni
// yalnız gövdede gider, URL'ye ve önbellek anahtarına yazılmaz (053-04 §10, 053-05 §9). Yanıtlar
// @eda/contracts/api şemalarıyla doğrulanır; kaynak hatalarında Retry-After ve kaynak kodu taşınır.
import {
  ArticleDto,
  type ArticleDtoValue,
  DecisionDto,
  type DecisionDtoValue,
  type DecisionSearchRequestValue,
  LawDto,
  type LawDtoValue,
  type LegislationSearchRequestValue,
  LegislationSearchResultsDto,
  type LegislationSearchResultsDtoValue,
  SearchResultsDto,
  type SearchResultsDtoValue,
  type SearchSort,
  SectionDto,
  type SectionDtoValue,
} from '@eda/contracts/api';
import type { LawType } from '@eda/contracts/enums';
import { ApiError, type ApiErrorInfo, parseErrorEnvelope } from './api-error.ts';
import { guardedFetch } from './session-guard.ts';
import { uuidv7 } from './uuid.ts';

export type SourceErrorInfo = ApiErrorInfo & {
  reason: string | null;
  /** `Retry-After` (sn) veya zarf `meta.retryAfterSec`. */
  retryAfterSec: number | null;
  source: string | null;
};

/** Zarfın `reason` ve `meta` alanlarını da taşıyan api hatası. */
export class ResearchApiError extends ApiError {
  readonly detail: SourceErrorInfo;
  constructor(detail: SourceErrorInfo) {
    super(detail);
    this.name = 'ResearchApiError';
    this.detail = detail;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function detailOf(text: string, res: Response): SourceErrorInfo {
  const base = parseErrorEnvelope(text, res.status) ?? {
    code: 'CLIENT_HTTP_ERROR',
    message: null,
    requestId: res.headers.get('x-request-id'),
    status: res.status,
  };
  let reason: string | null = null;
  let source: string | null = null;
  let metaRetry: number | null = null;
  try {
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && isRecord(body.error)) {
      if (typeof body.error.reason === 'string') reason = body.error.reason;
      const meta = body.error.meta;
      if (isRecord(meta)) {
        if (typeof meta.source === 'string') source = meta.source;
        if (typeof meta.retryAfterSec === 'number') metaRetry = meta.retryAfterSec;
      }
    }
  } catch {
    // Zarf okunamadı: genel bilgi yeterli.
  }
  const header = Number(res.headers.get('retry-after'));
  const retryAfterSec = Number.isFinite(header) && header > 0 ? header : metaRetry;
  return { ...base, reason, source, retryAfterSec };
}

/** Zod şemasının yalnız kullanılan yüzü (web `zod`'a doğrudan bağımlı değildir). */
type Schema<T> = {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
};

async function request<T>(
  schema: Schema<T>,
  path: string,
  init: RequestInit = {},
  fetcher: typeof fetch = guardedFetch,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-request-id', uuidv7());
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await fetcher(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ResearchApiError({
      code: 'CLIENT_NETWORK',
      message: null,
      requestId: null,
      status: null,
      reason: null,
      retryAfterSec: null,
      source: null,
    });
  }
  const text = await res.text();
  if (!res.ok) throw new ResearchApiError(detailOf(text, res));
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ResearchApiError({
      code: 'CLIENT_INVALID_RESPONSE',
      message: null,
      requestId: res.headers.get('x-request-id'),
      status: res.status,
      reason: null,
      retryAfterSec: null,
      source: null,
    });
  }
  return parsed.data;
}

/** Hata ayrıntısı (ResearchApiError değilse yalnız kod). */
export function researchErrorOf(err: unknown): SourceErrorInfo {
  if (err instanceof ResearchApiError) return err.detail;
  if (err instanceof ApiError) {
    return { ...err.info, reason: null, retryAfterSec: null, source: null };
  }
  return {
    code: 'CLIENT_UNKNOWN',
    message: null,
    requestId: null,
    status: null,
    reason: null,
    retryAfterSec: null,
    source: null,
  };
}

const DECISIONS = '/api/v1/decisions';
const LEGISLATION = '/api/v1/legislation';
const seg = encodeURIComponent;

export type Fetcher = typeof fetch;

export function searchDecisions(
  body: DecisionSearchRequestValue,
  fetcher?: Fetcher,
): Promise<SearchResultsDtoValue> {
  return request(
    SearchResultsDto,
    `${DECISIONS}/search`,
    { method: 'POST', body: JSON.stringify(body) },
    fetcher,
  );
}

export function getSearchPage(
  searchId: string,
  q: { page: number; sort: SearchSort },
  fetcher?: Fetcher,
): Promise<SearchResultsDtoValue> {
  // Yalnız sayfa ve sıralama; sorgu metni URL'de taşınmaz.
  const params = new URLSearchParams({ page: String(q.page), sort: q.sort });
  return request(SearchResultsDto, `${DECISIONS}/searches/${seg(searchId)}?${params}`, {}, fetcher);
}

export function requestLiveSearch(
  searchId: string,
  more: boolean,
  fetcher?: Fetcher,
): Promise<SearchResultsDtoValue> {
  return request(
    SearchResultsDto,
    `${DECISIONS}/searches/${seg(searchId)}/live`,
    { method: 'POST', body: JSON.stringify({ more }) },
    fetcher,
  );
}

export function getDecision(decisionId: string, fetcher?: Fetcher): Promise<DecisionDtoValue> {
  return request(DecisionDto, `${DECISIONS}/${seg(decisionId)}`, {}, fetcher);
}

export function getDecisionSection(
  decisionId: string,
  sectionNo: number,
  fetcher?: Fetcher,
): Promise<SectionDtoValue> {
  return request(SectionDto, `${DECISIONS}/${seg(decisionId)}/sections/${sectionNo}`, {}, fetcher);
}

export function searchLegislation(
  body: LegislationSearchRequestValue,
  fetcher?: Fetcher,
): Promise<LegislationSearchResultsDtoValue> {
  return request(
    LegislationSearchResultsDto,
    `${LEGISLATION}/search`,
    { method: 'POST', body: JSON.stringify(body) },
    fetcher,
  );
}

function typeQuery(type: LawType | null, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (type !== null) p.set('type', type);
  const s = p.toString();
  return s === '' ? '' : `?${s}`;
}

export function getLaw(
  lawNo: string,
  type: LawType | null,
  fetcher?: Fetcher,
): Promise<LawDtoValue> {
  return request(LawDto, `${LEGISLATION}/laws/${seg(lawNo)}${typeQuery(type)}`, {}, fetcher);
}

export function getArticle(
  lawNo: string,
  articleNo: string,
  opts: { type: LawType | null; asOf: string | null },
  fetcher?: Fetcher,
): Promise<ArticleDtoValue> {
  const extra: Record<string, string> = opts.asOf === null ? {} : { asOf: opts.asOf };
  return request(
    ArticleDto,
    `${LEGISLATION}/laws/${seg(lawNo)}/articles/${seg(articleNo)}${typeQuery(opts.type, extra)}`,
    {},
    fetcher,
  );
}
