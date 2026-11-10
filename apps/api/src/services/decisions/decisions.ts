// Karar Arşivi iş kuralları (P16.5–P16.9; 041 §5.2; 053-04 §4.6). Hono bilmez.
// - `search` yalnız kaydı oluşturur; MCP çağrısı YAPMAZ (canlı arama hiçbir koşulda otomatik değildir).
// - `requestLive` yalnız kullanıcının "Resmî kaynakta ara" eylemiyle çağrılır.
// Yerel korpus (P14) yok: yerel bölüm boştur, canlı arama birincil eylemdir.
import { type DecisionHit, decisionLongKunye, decisionShortKunye } from '@eda/ai';
import {
  ARCHIVE_PAGE_SIZE,
  ARCHIVE_POOL_MAX,
  CHAMBER_COURT_TYPES,
  type CorpusFiltersValue,
  type DecisionDtoValue,
  type DecisionHitDtoValue,
  type DecisionSearchRequestValue,
  decodeLiveDecisionId,
  encodeLiveDecisionId,
  type LiveSourceStateValue,
  type SearchPageQueryValue,
  type SearchResultsDtoValue,
  type SearchSort,
  type SectionDtoValue,
} from '@eda/contracts/api';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { SearchCourtType } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import {
  ChamberCode,
  type DecisionLiveSourceCode,
  type McpGetDecisionResult,
  type McpSearchDecisionsResult,
  type NormalizedDecisionValue,
} from '@eda/contracts/mcp';
import { COURT_TYPES, type CourtType } from '@eda/contracts/tools';
import { piiDetected } from '@eda/kvkk';
import { strictPhrase } from '../../chat/mcp-backend.ts';
import { liveErrorToAppError, retryAfterSec } from '../sources/errors.ts';
import { type LiveSource, LiveSourceError } from '../sources/live-source.ts';
import {
  type LiveQuota,
  type LiveSourceProgress,
  SEARCH_TTL_MS,
  type SearchStore,
  type StoredSearch,
} from './search-store.ts';

const PAGE_SIZE_LIVE = CONFIG_DEFAULTS['sources.mcpPageSizeMax'];
const FIRST_PAGE: SearchPageQueryValue = { page: 1, limit: ARCHIVE_PAGE_SIZE, sort: 'relevance' };
const MCP_QUERY_MAX = 300;

/** 023 §9: mahkeme türü → MVP canlı kaynak; KİK/Rekabet/GİB MVP'de canlı değildir. */
const COURT_SOURCE: Record<SearchCourtType, DecisionLiveSourceCode | null> = {
  yargitay: 'bedesten',
  danistay: 'bedesten',
  istinaf_hukuk: 'bedesten',
  ilk_derece_hukuk: 'bedesten',
  kyb: 'bedesten',
  aym_bireysel: 'anayasa',
  aym_norm: 'anayasa',
  uyusmazlik: 'uyusmazlik',
  kik: null,
  rekabet: null,
  gib: null,
};
const LIVE_ORDER: readonly DecisionLiveSourceCode[] = ['bedesten', 'anayasa', 'uyusmazlik'];

export type DecisionServiceDeps = {
  source: LiveSource;
  store: SearchStore;
  quota: LiveQuota;
  now: () => number;
  uuid: () => string;
};

/** Sorguda yapısal kişisel veri var mı; algılayıcı hata verirse var sayılır (fail-closed, P16.6). */
export function queryHasPii(query: string): boolean {
  try {
    return piiDetected(query, { level: 'standard' });
  } catch {
    return true;
  }
}

/**
 * Akıllı otomatik seçimde Uyuşmazlık Mahkemesi canlı aranmaz (portal tam metin araması 23–27 sn,
 * ); kurum kapsamda açıkça seçilince aranır. Bedesten ve AYM yanıtı bu süreyi beklemez.
 */
const AUTO_LIVE: readonly DecisionLiveSourceCode[] = ['bedesten', 'anayasa'];

function liveSourcesOf(filters: CorpusFiltersValue): DecisionLiveSourceCode[] {
  if (filters.courtTypes === null) return [...AUTO_LIVE];
  const set = new Set(filters.courtTypes.map((c) => COURT_SOURCE[c]));
  return LIVE_ORDER.filter((s) => set.has(s));
}

function mcpCourtTypes(filters: CorpusFiltersValue, source: DecisionLiveSourceCode) {
  if (filters.courtTypes === null) return null;
  const mcp = new Set<string>(COURT_TYPES);
  const picked = filters.courtTypes.filter(
    (c): c is CourtType => COURT_SOURCE[c] === source && mcp.has(c),
  );
  return picked.length > 0 ? picked : null;
}

/** Sorgudaki esas/karar numarası ("2024/123 E.", "K. 2025/45") canlı aramada ayrı süzgeç olur. */
export function docketOf(query: string): { esas: string | null; karar: string | null } {
  let esas: string | null = null;
  let karar: string | null = null;
  const rx = /(?:\b([EK])\.?\s*(\d{4}\/\d{1,7}))|(?:(\d{4}\/\d{1,7})\s*([EK])\b)/g;
  for (const m of query.matchAll(rx)) {
    const kind = m[1] ?? m[4];
    const no = m[2] ?? m[3] ?? null;
    if (kind === 'E') esas ??= no;
    if (kind === 'K') karar ??= no;
  }
  return { esas, karar };
}

/** MCP sorgusu en çok 300 karakter (021 §5.4); uzun metin kelime sınırında kısaltılır. */
export function liveQueryOf(query: string): string {
  const q = query.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (q.length <= MCP_QUERY_MAX) return q;
  const cut = q.slice(0, MCP_QUERY_MAX);
  const sp = cut.lastIndexOf(' ');
  return sp >= 2 ? cut.slice(0, sp) : cut;
}

function validateFilters(f: CorpusFiltersValue): void {
  if (f.dateFrom !== null && f.dateTo !== null && f.dateFrom > f.dateTo) {
    throw new AppError('VALIDATION_FAILED', {
      fields: [{ path: 'body.filters.dateFrom', issue: 'invalid_range' }],
    });
  }
  if (f.chamberCodes !== null) {
    const chamberCourts = new Set<string>(CHAMBER_COURT_TYPES);
    const courtsOk = f.courtTypes?.every((c) => chamberCourts.has(c)) ?? false;
    const ok = courtsOk && f.chamberCodes.every((c) => ChamberCode.safeParse(c).success);
    if (!ok) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'body.filters.chamberCodes', issue: 'not_allowed' }],
      });
    }
  }
}

function asLiveSource(s: string): DecisionLiveSourceCode | null {
  return s === 'bedesten' || s === 'anayasa' || s === 'uyusmazlik' ? s : null;
}

function kunyeInput(h: NormalizedDecisionValue, source: DecisionLiveSourceCode): DecisionHit {
  return {
    source,
    document_id: h.document_id,
    court_type: h.court_type,
    court: h.court,
    chamber: h.chamber,
    esas_no: h.esas_no,
    karar_no: h.karar_no,
    decision_date: h.decision_date,
    title: h.title,
    snippet: h.snippet,
    url: h.url,
    retrieved_at: h.retrieved_at,
  };
}

export function toHitDto(h: NormalizedDecisionValue): DecisionHitDtoValue | null {
  const source = asLiveSource(h.source);
  if (source === null) return null;
  return {
    decisionId: encodeLiveDecisionId(source, h.document_id),
    source,
    origin: 'live',
    court: h.court,
    chamber: h.chamber,
    esasNo: h.esas_no,
    kararNo: h.karar_no,
    decisionDate: h.decision_date,
    shortKunye: decisionShortKunye(kunyeInput(h, source)),
    title: h.title.trim() === '' ? null : h.title,
    snippet: h.snippet,
    highlights: [],
    relevance: null,
    url: h.url,
    retrievedAt: h.retrieved_at,
    citedArticles: [],
    hasDissent: false,
    textStatus: 'unknown',
  };
}

function sortHits(hits: readonly NormalizedDecisionValue[], sort: SearchSort) {
  if (sort === 'relevance') return hits;
  const dir = sort === 'date_desc' ? -1 : 1;
  // Tarihsiz kararlar her iki yönde sona; eşitlikte özgün sıra korunur (kararlı sıralama).
  return [...hits].sort((a, b) => {
    if (a.decision_date === b.decision_date) return 0;
    if (a.decision_date === null) return 1;
    if (b.decision_date === null) return -1;
    return a.decision_date < b.decision_date ? -dir : dir;
  });
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function buildResults(s: StoredSearch, q: SearchPageQueryValue): SearchResultsDtoValue {
  const sorted = sortHits(s.live.hits, q.sort);
  const total = sorted.length;
  const pageCount = Math.ceil(total / q.limit);
  const start = (q.page - 1) * q.limit;
  const items = sorted.slice(start, start + q.limit).flatMap((h) => toHitDto(h) ?? []);
  const sources: LiveSourceStateValue[] = [...s.live.sources].map(([source, p]) => ({
    source,
    status: p.status,
    retryAfterSec: p.retryAfterSec,
    resultCount: p.resultCount,
    hasMore: p.hasMore,
  }));
  const available = s.liveSources.length > 0;
  return {
    searchId: s.id,
    query: s.query,
    filters: s.filters,
    items,
    nextCursor: null,
    empty: total === 0,
    degraded: false,
    // Yerel korpus yokken yerel sonuç her zaman azdır; canlı arama birincil önerilir.
    liveReasons: available && !s.piiFlag ? ['few_local_results'] : [],
    live: {
      available,
      requested: s.live.requested,
      status: s.live.status,
      staleAsOf: s.live.staleAsOf,
      sources,
      hasMore: total < ARCHIVE_POOL_MAX && sources.some((x) => x.hasMore),
    },
    localCorpus: { available: false },
    overview: { status: 'none', text: null, generatedAt: null, badge: null, sources: [] },
    rerank: { available: false, status: 'none' },
    pagination: { page: q.page, pageSize: q.limit, pageCount, total },
    sort: q.sort,
    expiresAt: iso(s.expiresAt),
    createdAt: iso(s.createdAt),
  };
}

type SourceOutcome =
  | { source: DecisionLiveSourceCode; ok: true; result: McpSearchDecisionsResult; query: string }
  | { source: DecisionLiveSourceCode; ok: false; err: LiveSourceError };

function statusOf(err: LiveSourceError): LiveSourceProgress['status'] {
  switch (err.code) {
    case 'SOURCE_NOT_IN_COVERAGE':
      return 'not_in_coverage';
    case 'SOURCE_BUSY':
      return 'busy';
    case 'SOURCE_RATE_LIMITED':
      return 'rate_limited';
    default:
      return 'unavailable';
  }
}

export function createDecisionService(deps: DecisionServiceDeps) {
  const notFound = () =>
    new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'decision_search' });

  function load(id: string): StoredSearch {
    const s = deps.store.get(id, deps.now());
    if (!s) throw notFound();
    return s;
  }

  async function runSource(
    s: StoredSearch,
    source: DecisionLiveSourceCode,
    page: number,
    previousQuery: string | null,
    signal: AbortSignal,
  ): Promise<SourceOutcome> {
    const base = liveQueryOf(s.query);
    const docket = docketOf(base);
    const args = {
      source,
      query: previousQuery ?? base,
      court_types: mcpCourtTypes(s.filters, source),
      chamber: source === 'bedesten' ? (s.filters.chamberCodes?.[0] ?? null) : null,
      date_from: s.filters.dateFrom,
      date_to: s.filters.dateTo,
      esas_no: docket.esas,
      karar_no: docket.karar,
      page,
      page_size: PAGE_SIZE_LIVE,
    };
    try {
      if (previousQuery === null && docket.esas === null && docket.karar === null) {
        // işleçsiz çok terimli sorguda terimler zorunlu; 3'ten az sonuçta özgün ifade.
        const strict = strictPhrase(base);
        if (strict !== null && strict.length <= MCP_QUERY_MAX) {
          const r = await deps.source.searchDecisions({ ...args, query: strict }, signal);
          if (r.results.length >= 3) return { source, ok: true, result: r, query: strict };
        }
      }
      const r = await deps.source.searchDecisions(args, signal);
      return { source, ok: true, result: r, query: args.query };
    } catch (err) {
      if (err instanceof LiveSourceError) return { source, ok: false, err };
      throw err;
    }
  }

  return {
    search(req: DecisionSearchRequestValue): SearchResultsDtoValue {
      validateFilters(req.filters);
      const now = deps.now();
      const piiFlag = queryHasPii(req.query);
      const s: StoredSearch = {
        id: deps.uuid(),
        query: req.query,
        filters: req.filters,
        piiFlag,
        liveSources: liveSourcesOf(req.filters),
        createdAt: now,
        expiresAt: now + SEARCH_TTL_MS,
        live: {
          requested: false,
          status: piiFlag ? 'blocked_pii' : 'none',
          staleAsOf: null,
          inFlight: false,
          sources: new Map(),
          hits: [],
        },
      };
      deps.store.add(s, now);
      return buildResults(s, FIRST_PAGE);
    },

    getPage(id: string, q: SearchPageQueryValue): SearchResultsDtoValue {
      return buildResults(load(id), q);
    },

    async requestLive(
      id: string,
      more: boolean,
      signal: AbortSignal,
    ): Promise<SearchResultsDtoValue> {
      const s = load(id);
      const first = FIRST_PAGE;
      if (s.piiFlag) {
        throw new AppError('SOURCE_PII_BLOCKED', {
          reason: 'pii_detected',
          actions: ['remove_personal_data'],
        });
      }
      if (s.liveSources.length === 0) {
        throw new AppError('SOURCE_NOT_IN_COVERAGE', { actions: ['open_portal'] });
      }
      // Aynı arama için ikinci istek portala gitmez; mevcut durum döner (041 §5.2 varsayımı).
      if (s.live.inFlight || (s.live.requested && !more)) return buildResults(s, first);
      const targets = s.live.requested
        ? [...s.live.sources].filter(([, p]) => p.hasMore).map(([src]) => src)
        : s.liveSources;
      if (targets.length === 0 || s.live.hits.length >= ARCHIVE_POOL_MAX) {
        return buildResults(s, first);
      }
      const quota = deps.quota.take(deps.now());
      if (!quota.ok) {
        throw new AppError('SOURCE_RATE_LIMITED', {
          reason: 'user_live_quota',
          meta: { retryAfterSec: retryAfterSec(quota.retryAfterMs) },
        });
      }
      s.live.inFlight = true;
      let outcomes: SourceOutcome[];
      try {
        outcomes = await Promise.all(
          targets.map((src) => {
            const prev = s.live.sources.get(src);
            return runSource(s, src, prev?.nextPage ?? 1, prev ? prev.query : null, signal);
          }),
        );
      } finally {
        s.live.inFlight = false;
      }

      const pii = outcomes.find((o) => !o.ok && o.err.code === 'SOURCE_PII_BLOCKED');
      if (pii && !pii.ok) {
        s.piiFlag = true;
        s.live.status = 'blocked_pii';
        throw liveErrorToAppError(pii.err);
      }

      const seen = new Set(s.live.hits.map((h) => `${h.source}:${h.document_id}`));
      let anyOk = false;
      let allStale = true;
      for (const o of outcomes) {
        const prev = s.live.sources.get(o.source);
        if (o.ok) {
          anyOk = true;
          const r = o.result;
          if (r.status !== 'stale') allStale = false;
          else s.live.staleAsOf = r.stale_as_of;
          let added = 0;
          for (const h of r.results) {
            const key = `${h.source}:${h.document_id}`;
            if (seen.has(key) || s.live.hits.length >= ARCHIVE_POOL_MAX) continue;
            seen.add(key);
            s.live.hits.push(h);
            added += 1;
          }
          s.live.sources.set(o.source, {
            status: r.status === 'stale' ? 'stale' : 'done',
            retryAfterSec: null,
            resultCount: (prev?.resultCount ?? 0) + added,
            hasMore: r.has_more ?? r.results.length >= r.page_size,
            nextPage: (prev?.nextPage ?? 1) + 1,
            query: o.query,
          });
        } else {
          const busy = o.err.code === 'SOURCE_BUSY' || o.err.code === 'SOURCE_RATE_LIMITED';
          s.live.sources.set(o.source, {
            status: statusOf(o.err),
            retryAfterSec: busy ? retryAfterSec(o.err.retryAfterMs) : null,
            resultCount: prev?.resultCount ?? 0,
            // Kalıcı olmayan hatada aynı sayfa yeniden denenebilir.
            hasMore: o.err.code !== 'SOURCE_NOT_IN_COVERAGE' && (prev?.hasMore ?? true),
            nextPage: prev?.nextPage ?? 1,
            query: prev?.query ?? liveQueryOf(s.query),
          });
        }
      }

      if (anyOk) {
        s.live.requested = true;
        s.live.status = allStale ? 'stale' : 'done';
        if (!allStale) s.live.staleAsOf = null;
        return buildResults(s, first);
      }
      // Hiçbir kaynak yanıt vermedi: hata zarfı (021 §6.4). Önce yoğunluk, sonra hız, sonra erişim.
      const errors = outcomes.flatMap((o) => (o.ok ? [] : [o.err]));
      const pick =
        errors.find((e) => e.code === 'SOURCE_BUSY') ??
        errors.find((e) => e.code === 'SOURCE_RATE_LIMITED') ??
        errors.find((e) => e.code !== 'SOURCE_NOT_IN_COVERAGE') ??
        errors[0];
      if (!pick) return buildResults(s, first);
      if (!s.live.requested) {
        s.live.status =
          pick.code === 'SOURCE_BUSY' || pick.code === 'SOURCE_RATE_LIMITED'
            ? 'busy'
            : pick.code === 'SOURCE_NOT_IN_COVERAGE'
              ? 'none'
              : 'unavailable';
      }
      throw liveErrorToAppError(pick);
    },
  };
}

export type DecisionService = ReturnType<typeof createDecisionService>;

// --- Karar okuma (P16.9) -------------------------------------------------------------------------

export type DecisionReaderDeps = { source: LiveSource; now: () => number };

type CacheEntry = { at: number; value: McpGetDecisionResult };

const DOC_TTL_MS = CONFIG_DEFAULTS['sources.docLruTtlSec'] * 1000;
const DOC_MAX = CONFIG_DEFAULTS['sources.docLruMaxEntries'];

export function toDecisionDto(decisionId: string, r: McpGetDecisionResult): DecisionDtoValue {
  const kunye: DecisionHit = {
    source: r.source,
    document_id: r.document_id,
    court_type: r.court_type,
    court: r.court ?? '',
    chamber: r.chamber,
    esas_no: r.esas_no,
    karar_no: r.karar_no,
    decision_date: r.decision_date,
    title: r.title ?? '',
    snippet: null,
    url: r.url,
    retrieved_at: r.retrieved_at,
  };
  return {
    decisionId,
    canonicalDecisionId: null,
    source: r.source,
    origin: 'live',
    court: r.court ?? '',
    chamber: r.chamber,
    esasNo: r.esas_no,
    kararNo: r.karar_no,
    decisionDate: r.decision_date,
    shortKunye: decisionShortKunye(kunye),
    fullKunye: decisionLongKunye(kunye),
    title: r.title,
    textStatus: r.text_status === 'ok' ? 'full' : 'unavailable',
    sectionCount: r.total_sections,
    sections: r.sections.map((sec) => ({
      sectionNo: sec.no,
      role: sec.role,
      heading: null,
      charCount: sec.chars,
    })),
    citedArticles: [],
    facets: null,
    url: r.url,
    aiSummary: null,
    retrievedAt: r.retrieved_at,
    warnings: r.warnings,
  };
}

/**
 * Canlı karar okuyucu: `get_decision` tam yanıtı (bölüm metinleriyle) kısa süre süreç belleğinde
 * tutulur (`sources.docLruTtlSec`, `sources.docLruMaxEntries`); bölüm istekleri yeniden MCP'ye gitmez.
 * Aynı karar için eşzamanlı istekler tek çağrıda birleşir.
 */
export function createDecisionReader(deps: DecisionReaderDeps) {
  const cache = new Map<string, CacheEntry>();
  const flights = new Map<string, Promise<McpGetDecisionResult>>();

  async function fetchDoc(decisionId: string, signal: AbortSignal): Promise<McpGetDecisionResult> {
    const live = decodeLiveDecisionId(decisionId);
    // Yerel korpus kimlikleri (uuid) P14'e dek çözülemez: kayıt yok.
    if (!live) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'decision' });
    const now = deps.now();
    const hit = cache.get(decisionId);
    if (hit && now - hit.at < DOC_TTL_MS) return hit.value;
    const pending = flights.get(decisionId);
    if (pending) return pending;
    const p = deps.source
      .getDecision({ source: live.source, document_id: live.documentId, section: null }, signal)
      .then((value) => {
        cache.delete(decisionId);
        cache.set(decisionId, { at: deps.now(), value });
        while (cache.size > DOC_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
        return value;
      })
      .catch((err: unknown) => {
        throw err instanceof LiveSourceError ? liveErrorToAppError(err, 'source_document') : err;
      })
      .finally(() => flights.delete(decisionId));
    flights.set(decisionId, p);
    return p;
  }

  return {
    async getDecision(decisionId: string, signal: AbortSignal): Promise<DecisionDtoValue> {
      return toDecisionDto(decisionId, await fetchDoc(decisionId, signal));
    },
    async getSection(
      decisionId: string,
      sectionNo: number,
      signal: AbortSignal,
    ): Promise<SectionDtoValue> {
      const doc = await fetchDoc(decisionId, signal);
      const sec = doc.sections.find((x) => x.no === sectionNo);
      if (!sec || sec.markdown === null) {
        throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'decision' });
      }
      const max = CONFIG_DEFAULTS['sources.decisionSectionMaxChars'];
      return {
        sectionNo: sec.no,
        role: sec.role,
        heading: null,
        text: sec.markdown.slice(0, max),
        charCount: sec.chars,
      };
    },
  };
}

export type DecisionReader = ReturnType<typeof createDecisionReader>;
