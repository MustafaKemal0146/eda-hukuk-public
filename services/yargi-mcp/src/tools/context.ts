// Araç bağımlılıkları ve çağrı bağlamı. Paylaşılan durum (sonuç önbelleği, tek uçuş kilidi; ağ geçidinde
// kova ve kesici) valkey-cache'tedir. Belge tamponu, künye/portal kimlikleri ve form alanları
// plan gereği süreç içidir (021 §5.9; karar tam metni Valkey'e yazılmaz).
import type { SourceCode } from '@eda/contracts/enums';
import type { McpCacheScope, McpPriority, NormalizedDecisionValue } from '@eda/contracts/mcp';
import type { SourcesConfig } from '../config/sources.ts';
import { type ResultCache, TtlLru } from '../resilience/cache.ts';
import { type FlightLock, SingleFlight } from '../resilience/single-flight.ts';
import type { UpstreamGateway } from '../sources/gateway.ts';
import type { LawArticle } from '../sources/mevzuat/articles.ts';
import type { UyusmazlikFormTokens } from '../sources/uyusmazlik/parse.ts';

export type DecisionDoc = {
  kind: 'decision';
  mimeType: 'text/html' | 'application/pdf';
  textStatus: 'ok' | 'text_unavailable';
  text: string;
  truncated: boolean;
};

export type LawDoc = { kind: 'law'; articles: LawArticle[] };

/** Belge tamponu üst sınırı (021 §5.9: 64 MB). */
export const DOC_BUFFER_MAX_BYTES = 64 * 1024 * 1024;

export type ToolDeps = {
  gateway: UpstreamGateway;
  cfg: SourcesConfig;
  /** Etkin kaynaklar: `YARGI_SOURCES_ENABLED`, `eda:cfg:sources` ile daraltılabilir (yerinde güncellenir). */
  enabled: Set<SourceCode>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  /** Arama ve mevzuat sonuç önbelleği: valkey-cache `eda:src:` (normalize JSON; sorgu metni yok). */
  resultCache: ResultCache;
  /** Replikalar arası tek uçuş kilidi: valkey-cache `eda:sf:`. */
  locks: FlightLock;
  /** valkey-cache işlemi başarısız (gözlem; karar çağıranda). */
  reportDegraded: (op: string) => void;
  /** Süreç içi belge tamponu (tam metin yalnız burada; Valkey'e yazılmaz). */
  docBuffer: TtlLru<DecisionDoc | LawDoc>;
  /** Aramada görülen künye: get_decision meta verisi için (belge yanıtı künye taşımaz). */
  decisionMeta: TtlLru<NormalizedDecisionValue>;
  /** Portalın iç kayıt kimliği (AYM: `ND/…`/`BB/…` → kayıt UUID'si); belge çözümleme isteğini atlatır. */
  portalRefs: TtlLru<string>;
  /** Uyuşmazlık arama formunun gizli alanları (kamu sayfa durumu; çerez/kimlik değildir). */
  formTokens: TtlLru<UyusmazlikFormTokens>;
  /** Süreç içi tek uçuş (arama anahtarı ve `(source, document_id)` belge isteği). */
  flights: SingleFlight;
};

export type CallCtx = { org: string; priority: McpPriority; cacheScope: McpCacheScope };

export function createToolDeps(opts: {
  gateway: UpstreamGateway;
  cfg: SourcesConfig;
  enabled: Set<SourceCode>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  resultCache: ResultCache;
  locks: FlightLock;
  reportDegraded: (op: string) => void;
}): ToolDeps {
  return {
    gateway: opts.gateway,
    cfg: opts.cfg,
    enabled: opts.enabled,
    now: opts.now,
    sleep: opts.sleep,
    resultCache: opts.resultCache,
    locks: opts.locks,
    reportDegraded: opts.reportDegraded,
    docBuffer: new TtlLru<DecisionDoc | LawDoc>(opts.cfg.docLruMaxEntries, DOC_BUFFER_MAX_BYTES),
    decisionMeta: new TtlLru<NormalizedDecisionValue>(5000),
    portalRefs: new TtlLru<string>(5000),
    formTokens: new TtlLru<UyusmazlikFormTokens>(1),
    flights: new SingleFlight(),
  };
}

export const HOUR_MS = 3_600_000;

/** Aramada görülen künye ve portal kimliğinin saklanma süresi. */
export const DECISION_META_TTL_MS = 24 * HOUR_MS;

/** Form gizli alanlarının ömrü: 021 §5.7.4'teki antiforgery kuralı (≤ 10 dk) örnek alındı. */
export const FORM_TOKEN_TTL_MS = 10 * 60_000;
