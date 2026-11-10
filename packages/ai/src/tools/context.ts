// Araç bağlamı (021 §4.16): kaynak arka ucu (MCP veya korpus), etiket deposu, olay yayıcı ve tur bütçesi.
// Sunucu enjeksiyonu (orgId, sohbet, kapsam) burada taşınır; şemada yoktur.

import type { ScopeSelection } from '@eda/contracts/scope';
import type { PipelineData } from '@eda/contracts/stream';
import type { CourtType } from '@eda/contracts/tools';
import type { DocumentIntent } from '@eda/legal/intent';

export type IsoDate = string;

/** 021 §5.5 NormalizedDecision (yargi-mcp çıktısı; alt küme). */
export type DecisionHit = {
  source: 'bedesten' | 'anayasa' | 'uyusmazlik';
  document_id: string;
  court_type: CourtType;
  court: string;
  chamber: string | null;
  esas_no: string | null;
  karar_no: string | null;
  decision_date: IsoDate | null;
  title: string;
  snippet: string | null;
  url: string;
  retrieved_at: IsoDate;
};

export type DecisionDoc = DecisionHit & {
  text_status: 'ok' | 'text_unavailable';
  total_sections: number;
  sections: { no: number; role: string; chars: number; markdown: string | null }[];
};

export type LawHit = {
  law_no: string;
  law_name: string;
  article_no: string | null;
  title: string;
  snippet: string | null;
  url: string;
  last_amended_at: IsoDate | null;
  retrieved_at: IsoDate;
};

export type LawArticles = {
  law_no: string;
  law_name: string;
  url: string;
  retrieved_at: IsoDate;
  last_amended_at: IsoDate | null;
  articles: { article_no: string; heading: string | null; markdown: string; repealed: boolean }[];
};

export type SourceErrorCode =
  | 'SOURCE_UNAVAILABLE'
  | 'SOURCE_BUSY'
  | 'SOURCE_RATE_LIMITED'
  | 'SOURCE_NOT_IN_COVERAGE'
  | 'SOURCE_DOCUMENT_NOT_FOUND';

export class SourceError extends Error {
  readonly code: SourceErrorCode;
  constructor(code: SourceErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Kaynak arka ucu: api yargi-mcp istemcisiyle (ve P14'te yerel korpusla) gerçekler. */
export interface SourceBackend {
  searchDecisions(
    q: {
      /** P12 K7: tek canlı çağrı tek kaynağa. */
      source: DecisionHit['source'];
      query: string;
      courtTypes: CourtType[] | null;
      chamber: string | null;
      dateFrom: IsoDate | null;
      dateTo: IsoDate | null;
      esasNo: string | null;
      kararNo: string | null;
      page: number;
    },
    signal: AbortSignal,
  ): Promise<{ results: DecisionHit[]; hasMore: boolean; stale: boolean }>;
  getDecision(
    source: DecisionHit['source'],
    documentId: string,
    section: number | null,
    signal: AbortSignal,
  ): Promise<DecisionDoc>;
  searchLegislation(
    q: { query: string; lawNo: string | null },
    signal: AbortSignal,
  ): Promise<{ results: LawHit[] }>;
  getLegislationArticles(
    q: { lawNo: string; articleNo: string; articleTo: string | null },
    signal: AbortSignal,
  ): Promise<LawArticles>;
}

export type SourceRecord = {
  ref: string;
  /** `case_file`: sohbete eklenen evrak (P21 ilk dilimi; `source_key = file:<id>`, köken `user`). */
  kind: 'decision' | 'legislation' | 'case_file';
  sourceKey: string;
  sourceId: string;
  shortKunye: string;
  title: string;
  /** Resmî portal; evrak (`case_file`) kaynağında YOK. */
  portal?: 'bedesten' | 'anayasa' | 'uyusmazlik' | 'mevzuat';
  url?: string;
  retrievedAt: IsoDate;
  /** Kaynağın bu sohbet için getirildiği an (ISO 8601); künyede "erişim" tarihi buradan türer. */
  fetchedAt?: string;
  relevance: 'high' | 'medium';
  decision?: DecisionHit;
  law?: { lawNo: string; lawName: string; articleNo: string | null };
  /** Modele verilen kaynak metin (okunan bölüm/madde/özüt); yoksa model yalnız künyeyi gördü (#58). */
  excerpt?: string;
};

/** Kaynak kaydının `fetchedAt` değeri: bağlam saati varsa o, yoksa sistem saati (ISO 8601, UTC). */
export function fetchedAtNow(ctx: { now?: () => number }): string {
  return new Date(ctx.now ? ctx.now() : Date.now()).toISOString();
}

/** Sohbet başı monoton `[K#]` deposu (025 §4): aynı kaynak eski etiketini alır. */
export interface RefStore {
  allocate(sourceKey: string, make: (ref: string) => SourceRecord): SourceRecord;
  /**
   * Kalıcı depodan yüklenen kaynağı KENDİ etiketiyle geri koyar (P12: `[K#]` sohbetin DB kaydıdır,
   * etiket bir kez verilir ve değişmez). Sayaç verilen en büyük etiketin üstüne çıkar; kayıtlar
   * eksik/boşluklu olsa bile yeni kaynak mevcut bir etiketle ÇAKIŞMAZ.
   */
  restore(record: SourceRecord): void;
  byRef(ref: string): SourceRecord | undefined;
  all(): SourceRecord[];
}

export class MemoryRefStore implements RefStore {
  #next = 1;
  readonly #byKey = new Map<string, SourceRecord>();
  readonly #byRef = new Map<string, SourceRecord>();

  allocate(sourceKey: string, make: (ref: string) => SourceRecord): SourceRecord {
    const existing = this.#byKey.get(sourceKey);
    if (existing) return existing;
    const rec = make(`K${this.#next++}`);
    this.#byKey.set(sourceKey, rec);
    this.#byRef.set(rec.ref, rec);
    return rec;
  }

  restore(record: SourceRecord): void {
    // Bozuk/etiketsiz JSON satırı sayacı bozmaz: yalnız `K<sayı>` etiketleri geri yüklenir.
    const labeled = typeof record.ref === 'string' ? /^K([1-9]\d*)$/.exec(record.ref) : null;
    if (!labeled) return;
    if (this.#byKey.has(record.sourceKey) || this.#byRef.has(record.ref)) return;
    this.#byKey.set(record.sourceKey, record);
    this.#byRef.set(record.ref, record);
    const n = Number(labeled[1]);
    if (n >= this.#next) this.#next = n + 1;
  }

  byRef(ref: string): SourceRecord | undefined {
    return this.#byRef.get(ref);
  }
  all(): SourceRecord[] {
    return [...this.#byRef.values()];
  }
}

export type ToolEvent =
  | { type: 'pipeline'; data: PipelineData }
  | { type: 'sources'; turnRefs: string[] }
  | {
      type: 'notice';
      code: 'source_unavailable' | 'source_busy' | 'live_fallback_local';
      message: string;
    };

/**
 * Alıntı denetimi için tur belleği (025 §6.5 sağlayıcı 1): `[K#]` → bu turda araçla getirilen kaynak
 * metinleri. `complete` = metin kaynağın tamamıdır (karar tam metni, madde metni); özet/özüt değildir.
 * Yalnız süreç belleğinde yaşar; log, kuyruk ve DB'ye yazılmaz.
 */
export type QuoteText = { text: string; complete: boolean };
export type QuoteTextMemory = Map<string, QuoteText[]>;

/** Bağlamda tur belleği varsa kaynak metnini ekler (boş metin eklenmez). */
export function rememberQuoteText(
  ctx: Pick<ToolContext, 'quoteTexts'>,
  ref: string,
  text: string | null | undefined,
  complete: boolean,
): void {
  if (!ctx.quoteTexts || !text || text.trim() === '') return;
  const list = ctx.quoteTexts.get(ref) ?? [];
  list.push({ text, complete });
  ctx.quoteTexts.set(ref, list);
}

export type TurnBudget = {
  calls: number;
  liveSearches: number;
  liveFetches: number;
  resultTokens: number;
};

export type ToolContext = {
  backend: SourceBackend;
  refs: RefStore;
  emit: (e: ToolEvent) => void;
  budget: TurnBudget;
  /** Bu turda modele verilen etiketler (data-sources yalnız bunları değil tüm sohbeti taşır). */
  turnRefs: Set<string>;
  today: IsoDate;
  /** Saat (epoch ms); kaynak kaydının `fetchedAt` anı buradan alınır. Yoksa sistem saati. */
  now?: () => number;
  /** Kullanıcının yargı kapsamı (053/02 §4.3, P12 K5); modelin argümanından alınmaz. */
  scope: ScopeSelection;
  /** Bu turun belge niyeti (sunucu kuralı; modelin argümanından alınmaz). Yoksa kapı uygulanmaz. */
  documentIntent?: DocumentIntent;
  /** İstek `mode = 'petition'` (composer "Dilekçe" modu veya /dilekce). */
  petitionMode?: boolean;
  /** Alıntı denetimi tur belleği; verilmezse metin tutulmaz (alıntı denetimi yeniden getirmeye düşer). */
  quoteTexts?: QuoteTextMemory;
};
