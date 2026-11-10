// SourceBackend → yargi-mcp (021 §6). Hata eşlemesi: MCP hata kodu → SourceError (araç işleyicisi modele
// "erişilemedi" ile "sonuç yok"u ayrı yazar). Öncelik etkileşimli (interactive); kova kontrolleri P12.
// paralel araç çağrıları Bedesten kovasını (3,5 sn/istek) aşınca SOURCE_BUSY döner; kısa
// bekleme süresi içindeyse bir kez beklenip yeniden denenir (kova sınırı yargi-mcp'de korunur).
import { type DecisionHit, type SourceBackend, SourceError, type SourceErrorCode } from '@eda/ai';
import {
  getDecisionLive,
  getLegislationLive,
  type McpCallError,
  type McpResult,
  searchDecisionsLive,
  searchLegislationLive,
  type YargiMcpClient,
} from '@eda/ai/mcp';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { ChamberCode } from '@eda/contracts/mcp';

const PRIORITY = 'interactive' as const;

/** Bekleyerek yeniden deneme üst sınırı: kovanın kabul ettiği bekleme + bir token aralığı. */
const BUSY_RETRY_MAX_MS =
  CONFIG_DEFAULTS['sources.interactiveMaxWaitMs'] +
  CONFIG_DEFAULTS['sources.bedesten.tokenIntervalMs'];

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

/** SOURCE_BUSY ve önerilen bekleme sınır içindeyse bir kez bekleyip yeniden çağırır (arşiv uçları da kullanır). */
export async function withBusyRetry<T>(
  call: () => Promise<McpResult<T>>,
  signal: AbortSignal,
  sleep: Sleep,
): Promise<McpResult<T>> {
  const res = await call();
  if (res.ok || res.error.code !== 'SOURCE_BUSY') return res;
  const wait = res.error.retry_after_ms;
  if (wait === null || wait > BUSY_RETRY_MAX_MS) return res;
  await sleep(wait, signal);
  return call();
}

const STOP = new Set([
  've',
  'veya',
  'ile',
  'için',
  'hangi',
  'nasıl',
  'nedir',
  'olan',
  'gibi',
  'bir',
  'bu',
]);

/**
 * Bedesten düz ifadeyi VEYA ile eşler; alakasız kararlar öne çıkıyordu.
 * İşleçsiz çok terimli sorguda anlamlı terimlerin tamamı zorunlu (`+a +b`); tek terim veya işleçli sorgu
 * olduğu gibi kalır.
 */
export function strictPhrase(query: string): string | null {
  if (/["+-]/.test(query)) return null;
  const words = (query.normalize('NFC').match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length >= 3 && !STOP.has(w.toLocaleLowerCase('tr-TR')),
  );
  return words.length >= 2 ? words.map((w) => `+${w}`).join(' ') : null;
}

function fail(err: McpCallError): never {
  const map: Record<string, SourceErrorCode> = {
    SOURCE_BUSY: 'SOURCE_BUSY',
    SOURCE_RATE_LIMITED: 'SOURCE_RATE_LIMITED',
    SOURCE_NOT_IN_COVERAGE: 'SOURCE_NOT_IN_COVERAGE',
    SOURCE_DOCUMENT_NOT_FOUND: 'SOURCE_DOCUMENT_NOT_FOUND',
  };
  throw new SourceError(map[err.code] ?? 'SOURCE_UNAVAILABLE');
}

export function createMcpBackend(
  client: YargiMcpClient,
  sleep: Sleep = abortableSleep,
): SourceBackend {
  const opts = (signal: AbortSignal) => ({ priority: PRIORITY, signal });
  // Uyuşmazlık tam metin araması portalda uzundur: api → yargi-mcp süresi buna göre.
  const searchOpts = (signal: AbortSignal, source: string) =>
    source === 'uyusmazlik'
      ? { ...opts(signal), timeoutMs: CONFIG_DEFAULTS['sources.mcpSlowSearchTimeoutMs'] }
      : opts(signal);
  return {
    async searchDecisions(q, signal) {
      // Kaynak ve türleri araç işleyicisi kapsamla seçer (P12 K5/K7); daire kodu ve zorunlu terim
      // işleci yalnız Bedesten'de anlamlıdır.
      const bedesten = q.source === 'bedesten';
      const chamber =
        bedesten && q.chamber && ChamberCode.safeParse(q.chamber).success ? q.chamber : null;
      const args = {
        source: q.source,
        query: q.query,
        court_types: q.courtTypes && q.courtTypes.length > 0 ? q.courtTypes : null,
        chamber,
        date_from: q.dateFrom,
        date_to: q.dateTo,
        esas_no: q.esasNo,
        karar_no: q.kararNo,
        page: q.page,
        page_size: 5,
      };
      const strict =
        bedesten && q.esasNo === null && q.kararNo === null ? strictPhrase(q.query) : null;
      let res = await withBusyRetry(
        () =>
          searchDecisionsLive(
            client,
            strict ? { ...args, query: strict } : args,
            searchOpts(signal, q.source),
          ),
        signal,
        sleep,
      );
      // Zorunlu terimlerle 3'ten az sonuç: özgün ifadeyle bir kez daha (yeniden deneme değil, genişletme).
      if (strict && res.ok && res.value.results.length < 3) {
        res = await withBusyRetry(
          () => searchDecisionsLive(client, args, searchOpts(signal, q.source)),
          signal,
          sleep,
        );
      }
      if (!res.ok) fail(res.error);
      return {
        results: res.value.results as DecisionHit[],
        hasMore: res.value.has_more ?? false,
        stale: res.value.status === 'stale',
      };
    },
    async getDecision(source, documentId, section, signal) {
      const res = await withBusyRetry(
        () => getDecisionLive(client, { source, document_id: documentId, section }, opts(signal)),
        signal,
        sleep,
      );
      if (!res.ok) fail(res.error);
      const v = res.value;
      return {
        source: v.source,
        document_id: v.document_id,
        court_type: v.court_type,
        court: v.court ?? '',
        chamber: v.chamber,
        esas_no: v.esas_no,
        karar_no: v.karar_no,
        decision_date: v.decision_date,
        title: v.title ?? '',
        snippet: null,
        url: v.url,
        retrieved_at: v.retrieved_at,
        text_status: v.text_status,
        total_sections: v.total_sections,
        sections: v.sections,
      };
    },
    async searchLegislation(q, signal) {
      const res = await withBusyRetry(
        () =>
          searchLegislationLive(
            client,
            { query: q.query.slice(0, 200), law_no: q.lawNo, page: 1, page_size: 5 },
            opts(signal),
          ),
        signal,
        sleep,
      );
      if (!res.ok) fail(res.error);
      return { results: res.value.results };
    },
    async getLegislationArticles(q, signal) {
      const res = await withBusyRetry(
        () =>
          getLegislationLive(
            client,
            { law_no: q.lawNo, law_type: null, article_no: q.articleNo, article_to: q.articleTo },
            opts(signal),
          ),
        signal,
        sleep,
      );
      if (!res.ok) fail(res.error);
      return res.value;
    },
  };
}
