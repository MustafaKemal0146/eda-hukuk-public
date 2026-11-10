// Otomatik kayıt durum makinesi (050 §13.2; 054 §9.2): değişiklik `markDirty` ile bildirilir;
// `debounceMs` sessizlikten sonra veya ilk değişiklikten `maxWaitMs` sonra kaydedilir. Uçuşta tek istek
// vardır; uçuşta gelen değişiklik yanıttan sonra yeniden kaydedilir. Ağ hatası üstel geri çekilmeyle
// `retryMax` kez denenir; çakışma ve kalıcı hata yeniden denenmez (kullanıcıya gösterilir).
export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'retry' | 'conflict' | 'error';
export type SaveReason = 'autosave' | 'manual' | 'flush' | 'keepalive';
export type SaveResult =
  | { kind: 'ok' }
  | { kind: 'conflict' }
  | { kind: 'network' }
  | { kind: 'fatal' };

export type AutosaveOptions = {
  debounceMs: number;
  maxWaitMs: number;
  retryMax: number;
  save: (reason: SaveReason) => Promise<SaveResult>;
  onState: (state: SaveState) => void;
  /** Sınama için zamanlayıcı enjeksiyonu. */
  timers?: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (id: unknown) => void;
  };
};

const BACKOFF_CAP_MS = 30_000;

export class AutosaveController {
  readonly #o: AutosaveOptions;
  #state: SaveState = 'clean';
  #gen = 0;
  #debounce: unknown = null;
  #maxWait: unknown = null;
  #retry: unknown = null;
  #attempt = 0;
  #inflight = false;
  #queued: SaveReason | null = null;
  #disposed = false;

  constructor(options: AutosaveOptions) {
    this.#o = options;
  }

  get state(): SaveState {
    return this.#state;
  }

  #set(next: SaveState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.#o.onState(next);
  }

  #setTimer(fn: () => void, ms: number): unknown {
    return (this.#o.timers?.set ?? ((f, t) => setTimeout(f, t)))(fn, ms);
  }

  #clearTimer(id: unknown): void {
    if (id !== null) (this.#o.timers?.clear ?? ((x) => clearTimeout(x as never)))(id);
  }

  #clearAll(): void {
    this.#clearTimer(this.#debounce);
    this.#clearTimer(this.#maxWait);
    this.#clearTimer(this.#retry);
    this.#debounce = this.#maxWait = this.#retry = null;
  }

  /** İçerik değişti. Çakışma/kalıcı hata durumunda değişiklik yerelde kalır, kayıt denenmez. */
  markDirty(): void {
    if (this.#disposed) return;
    this.#gen += 1;
    if (this.#state === 'conflict' || this.#state === 'error') return;
    if (!this.#inflight) this.#set('dirty');
    this.#clearTimer(this.#debounce);
    this.#debounce = this.#setTimer(() => void this.flush('autosave'), this.#o.debounceMs);
    if (this.#maxWait === null) {
      this.#maxWait = this.#setTimer(() => void this.flush('autosave'), this.#o.maxWaitMs);
    }
  }

  /** Bekleyen değişikliği hemen gönderir (sürüm kaydı, sekme kapanışı, elle kayıt). */
  async flush(reason: SaveReason = 'flush'): Promise<void> {
    if (this.#disposed) return;
    this.#clearTimer(this.#debounce);
    this.#clearTimer(this.#maxWait);
    this.#clearTimer(this.#retry);
    this.#debounce = this.#maxWait = this.#retry = null;
    if (this.#inflight) {
      this.#queued = reason;
      return;
    }
    if (this.#state === 'clean' || this.#state === 'saved' || this.#state === 'conflict') return;
    if (this.#state === 'error') return;
    this.#inflight = true;
    this.#set('saving');
    const genAtSend = this.#gen;
    let result: SaveResult;
    try {
      result = await this.#o.save(reason);
    } catch {
      result = { kind: 'network' };
    }
    this.#inflight = false;
    if (this.#disposed) return;
    if (result.kind === 'ok') {
      this.#attempt = 0;
      if (this.#gen !== genAtSend || this.#queued !== null) {
        const q = this.#queued ?? 'autosave';
        this.#queued = null;
        this.#set('dirty');
        await this.flush(q);
      } else {
        this.#set('saved');
      }
      return;
    }
    this.#queued = null;
    if (result.kind === 'conflict') {
      this.#set('conflict');
      return;
    }
    if (result.kind === 'fatal') {
      this.#set('error');
      return;
    }
    this.#attempt += 1;
    if (this.#attempt > this.#o.retryMax) {
      this.#set('error');
      return;
    }
    this.#set('retry');
    const wait = Math.min(BACKOFF_CAP_MS, 1000 * 2 ** (this.#attempt - 1));
    this.#retry = this.#setTimer(() => {
      this.#set('dirty');
      void this.flush('autosave');
    }, wait);
  }

  /** Çakışma çözüldükten sonra (sunucu sürümü yüklendi) temiz duruma döner. */
  reset(): void {
    this.#clearAll();
    this.#attempt = 0;
    this.#queued = null;
    this.#set('clean');
  }

  /** Sunucudan gelen belgeyle senkronuz: `saved` göstergesi. */
  markSaved(): void {
    this.#set('saved');
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearAll();
  }

  /** Kaydedilmemiş değişiklik var mı (`beforeunload` yalnız bu durumlarda sorar). */
  get hasUnsaved(): boolean {
    return (
      this.#state === 'dirty' ||
      this.#state === 'saving' ||
      this.#state === 'retry' ||
      this.#state === 'error' ||
      this.#state === 'conflict'
    );
  }
}
