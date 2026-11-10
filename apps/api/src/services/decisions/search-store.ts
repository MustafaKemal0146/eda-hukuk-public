// Arama kaydı (`app.decision_searches` karşılığı): P03 gelene dek yalnız süreç belleğinde,
// yalnız development/test'te. Ömür `retention.decisionSearchHours`; süresi dolan kayıt yok sayılır.
// Sorgu metni yalnız burada (bellekte) durur; log, Valkey ve URL'ye yazılmaz (Y-41).
import type { CorpusFiltersValue, LiveSourceStateValue } from '@eda/contracts/api';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { LiveSearchStatus } from '@eda/contracts/enums';
import type { DecisionLiveSourceCode, NormalizedDecisionValue } from '@eda/contracts/mcp';

export const SEARCH_TTL_MS = CONFIG_DEFAULTS['retention.decisionSearchHours'] * 3_600_000;

export type LiveSourceProgress = Omit<LiveSourceStateValue, 'source'> & {
  /** Sonraki canlı sayfa (1'den). */
  nextPage: number;
  /** İlk sayfada seçilen sorgu biçimi; sonraki sayfalar aynısını kullanır. */
  query: string;
};

export type StoredSearch = {
  id: string;
  query: string;
  filters: CorpusFiltersValue;
  /** Sorguda kişisel veri algılandı (veya algılayıcı hata verdi; fail-closed). */
  piiFlag: boolean;
  /** Kapsamdaki MVP canlı kaynakları (023 §9 kapsam → kaynak). */
  liveSources: DecisionLiveSourceCode[];
  createdAt: number;
  expiresAt: number;
  live: {
    requested: boolean;
    status: LiveSearchStatus;
    staleAsOf: string | null;
    inFlight: boolean;
    sources: Map<DecisionLiveSourceCode, LiveSourceProgress>;
    hits: NormalizedDecisionValue[];
  };
};

export class SearchStore {
  readonly #items = new Map<string, StoredSearch>();
  readonly #max: number;

  /** Üst sınır bellek korumasıdır (ölçülmemiş). */
  constructor(max = 200) {
    this.#max = max;
  }

  add(search: StoredSearch, now: number): void {
    this.#sweep(now);
    while (this.#items.size >= this.#max) {
      const oldest = this.#items.keys().next().value;
      if (oldest === undefined) break;
      this.#items.delete(oldest);
    }
    this.#items.set(search.id, search);
  }

  get(id: string, now: number): StoredSearch | undefined {
    const s = this.#items.get(id);
    if (s && s.expiresAt <= now) {
      this.#items.delete(id);
      return undefined;
    }
    return s;
  }

  get size(): number {
    return this.#items.size;
  }

  #sweep(now: number): void {
    for (const [id, s] of this.#items) if (s.expiresAt <= now) this.#items.delete(id);
  }
}

/**
 * Kullanıcı başı canlı arama kovası (`sources.userLivePerMin`, 60 sn kayan pencere). Kimlik (P04)
 * gelene dek süreç tek kullanıcı sayılır; büro kovası (`sources.orgLivePerMin`) P04'te.
 */
export class LiveQuota {
  readonly #hits: number[] = [];
  readonly #perMin: number;

  constructor(perMin = CONFIG_DEFAULTS['sources.userLivePerMin']) {
    this.#perMin = perMin;
  }

  take(now: number): { ok: true } | { ok: false; retryAfterMs: number } {
    while (this.#hits.length > 0 && (this.#hits[0] ?? 0) <= now - 60_000) this.#hits.shift();
    if (this.#hits.length >= this.#perMin) {
      return { ok: false, retryAfterMs: (this.#hits[0] ?? now) + 60_000 - now };
    }
    this.#hits.push(now);
    return { ok: true };
  }
}
