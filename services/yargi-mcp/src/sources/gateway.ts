// Portal çağrı kapısı: devre kesici → token kovası (öncelik) → eşzamanlılık → taşıyıcı → sınıflama
// (021 §5.10–§5.12). 429'da yeniden deneme yok; ağ/zaman aşımı/5xx'te en çok `retries` jitter'lı deneme.
// Kesici ve kova durumu valkey-cache'tedir (çok replika); okunamıyorsa portala istek ATILMAZ:
// SOURCE_UNAVAILABLE `limiter_unavailable` (021 §5.10 son paragraf, KK-010-6). Sonuç sonrası kesici
// güncellemesi başarısızsa yanıt yine döner, yalnız `dependency.degraded` raporlanır.
import type { SourceCode } from '@eda/contracts/enums';
import type { McpPriority } from '@eda/contracts/mcp';
import type { SourcesConfig } from '../config/sources.ts';
import {
  MAX_DOC_BYTES,
  MAX_SEARCH_BYTES,
  type Transport,
  type UpstreamRequest,
  type UpstreamResponse,
} from '../http/fetch.ts';
import type { BreakerSnapshot, BreakerStore } from '../resilience/breaker.ts';
import { SourceMetrics } from '../resilience/metrics.ts';
import {
  type BucketSnapshot,
  type RateLimiter,
  retryAfterMs,
  Semaphore,
} from '../resilience/rate-limit.ts';
import { SourceError } from './errors.ts';

/** Kova anahtarı = portal arka ucu. AS-P11-04: mevzuat canlı yolu da bedesten.adalet.gov.tr
 * olduğundan (021 §5.7.4 aday 1) IP başına ölçülen Bedesten sınırını paylaşır; ayrı mevzuat kovası yok.
 * AYM'nin iki alan adı aynı arka ucu (`/api/core/public`) paylaştığından tek `anayasa` kovası. */
export const BUCKET_NAMES = ['bedesten', 'anayasa', 'uyusmazlik'] as const;
export type BucketName = (typeof BUCKET_NAMES)[number];

/** Kaynağın kullandığı kova (source_status doluluk oranı için). */
export function bucketOfSource(source: SourceCode): BucketName | null {
  if (source === 'bedesten' || source === 'mevzuat') return 'bedesten';
  if (source === 'anayasa' || source === 'uyusmazlik') return source;
  return null;
}

const WAF_MARKER = 'Bilgi Güvenliği Politikaları Gereği Kısıtlanmıştır';

export type GatewayDeps = {
  transport: Transport;
  cfg: SourcesConfig;
  userAgent: string;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  limiter: RateLimiter;
  breakers: BreakerStore;
  /** valkey-cache işlemi başarısız (fail-closed karar çağıranda); yalnız gözlem için. */
  reportDegraded: (op: string) => void;
};

export type GatewayCall = {
  source: SourceCode;
  bucket: BucketName;
  priority: McpPriority;
  kind: 'search' | 'doc';
  method: 'GET' | 'POST';
  url: string;
  headers: Readonly<Record<string, string>>;
  body: string | null;
};

const limiterUnavailable = (source: SourceCode): SourceError =>
  new SourceError('SOURCE_UNAVAILABLE', 'limiter_unavailable', { source });

export class UpstreamGateway {
  private readonly deps: GatewayDeps;
  private readonly semaphores = new Map<BucketName, Semaphore>();
  private readonly metrics = new Map<SourceCode, SourceMetrics>();

  constructor(deps: GatewayDeps) {
    this.deps = deps;
  }

  /** Kova aralığı `sources.<kaynak>.tokenIntervalMs` (021 §5.10). */
  intervalOf(name: BucketName): number {
    const { cfg } = this.deps;
    switch (name) {
      case 'bedesten':
        return cfg.bedestenTokenIntervalMs;
      case 'anayasa':
        return cfg.anayasaTokenIntervalMs;
      case 'uyusmazlik':
        return cfg.uyusmazlikTokenIntervalMs;
    }
  }

  bucketSnapshot(name: BucketName): Promise<BucketSnapshot> {
    const { cfg, now } = this.deps;
    return this.deps.limiter.snapshot(name, now(), this.intervalOf(name), cfg.priorityWindowMs);
  }

  breakerSnapshot(source: SourceCode): Promise<BreakerSnapshot> {
    return this.deps.breakers.snapshot(source, this.deps.now());
  }

  metricsOf(source: SourceCode): SourceMetrics {
    let m = this.metrics.get(source);
    if (!m) {
      m = new SourceMetrics();
      this.metrics.set(source, m);
    }
    return m;
  }

  /** Beklenen alan/seçici yoksa: devre kesici hatası sayılır (021 §5.11). */
  reportParseError(source: SourceCode): SourceError {
    const now = this.deps.now();
    void this.note('breaker_failure', () =>
      this.deps.breakers.onFailure(source, now, 'parse_error'),
    );
    this.metricsOf(source).record(now, 'error', null, 'parse_error');
    return new SourceError('SOURCE_UNAVAILABLE', 'parse_error', { source });
  }

  async request(call: GatewayCall): Promise<UpstreamResponse> {
    const { source } = call;
    const now = this.deps.now();
    let gate: Awaited<ReturnType<BreakerStore['allow']>>;
    try {
      gate = await this.deps.breakers.allow(source, now);
    } catch {
      this.deps.reportDegraded('breaker_allow');
      throw limiterUnavailable(source);
    }
    if (!gate.ok) {
      throw new SourceError('SOURCE_UNAVAILABLE', 'breaker_open', {
        source,
        retryAfterMs: gate.retryAfterMs,
      });
    }
    try {
      await this.acquire(call);
    } catch (err) {
      await this.note('breaker_release', () => this.deps.breakers.release(source, this.deps.now()));
      throw err;
    }
    const sem = this.semaphoreOf(call.bucket);
    return sem.run(() => this.attempt(call, 0));
  }

  /** Valkey güncellemesi: hata yanıtı bozmaz, yalnız raporlanır. */
  private async note(op: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      this.deps.reportDegraded(op);
    }
  }

  private semaphoreOf(name: BucketName): Semaphore {
    let s = this.semaphores.get(name);
    if (!s) {
      s = new Semaphore(() => this.deps.cfg.perSourceConcurrency);
      this.semaphores.set(name, s);
    }
    return s;
  }

  private async acquire(call: GatewayCall): Promise<void> {
    const { cfg, limiter } = this.deps;
    let res: Awaited<ReturnType<RateLimiter['take']>>;
    try {
      res = await limiter.take(call.bucket, call.priority, this.deps.now(), {
        intervalMs: this.intervalOf(call.bucket),
        maxWaitMs: cfg.interactiveMaxWaitMs,
        sharePct: cfg.interactiveSharePct,
        windowMs: cfg.priorityWindowMs,
      });
    } catch {
      this.deps.reportDegraded('limiter_take');
      throw limiterUnavailable(call.source);
    }
    if (!res.ok) {
      throw new SourceError(
        res.penalized ? 'SOURCE_RATE_LIMITED' : 'SOURCE_BUSY',
        res.penalized ? null : 'queue_wait_exceeded',
        { source: call.source, retryAfterMs: res.retryAfterMs },
      );
    }
    if (res.waitMs > 0) {
      try {
        await this.deps.sleep(res.waitMs);
      } finally {
        await this.note('limiter_done', () => limiter.doneWaiting(call.priority));
      }
    }
  }

  private async attempt(call: GatewayCall, tryNo: number): Promise<UpstreamResponse> {
    const { cfg, now, breakers } = this.deps;
    const { source } = call;
    const metrics = this.metricsOf(source);
    const req: UpstreamRequest = {
      method: call.method,
      url: call.url,
      headers: { 'User-Agent': this.deps.userAgent, 'Accept-Language': 'tr-TR', ...call.headers },
      body: call.body,
      timeoutMs:
        call.kind !== 'search'
          ? cfg.timeoutDocMs
          : source === 'uyusmazlik'
            ? cfg.uyusmazlikTimeoutSearchMs
            : cfg.timeoutSearchMs,
      maxBytes: call.kind === 'search' ? MAX_SEARCH_BYTES : MAX_DOC_BYTES,
    };
    const started = now();
    let res: UpstreamResponse;
    try {
      res = await this.deps.transport(req);
    } catch (err) {
      const e =
        err instanceof SourceError
          ? new SourceError(err.code, err.reason, { source })
          : new SourceError('SOURCE_UNAVAILABLE', 'network', { source });
      const t = now();
      if (e.reason === 'upstream_4xx') {
        await this.note('breaker_release', () => breakers.release(source, t));
        metrics.record(t, 'error', t - started, e.reason);
        throw e;
      }
      await this.note('breaker_failure', () =>
        breakers.onFailure(source, t, e.reason ?? 'network'),
      );
      metrics.record(t, e.reason === 'timeout' ? 'timeout' : 'error', t - started, e.reason);
      return this.retryOr(call, tryNo, e);
    }
    const t = now();
    const ms = t - started;
    if (res.status === 429) {
      const wait = retryAfterMs(
        res.headers['retry-after'],
        cfg.retryAfterDefaultSec,
        cfg.retryAfterMaxSec,
        t,
      );
      // 021 §5.10: kova Retry-After + 0,5 sn dondurulur.
      await this.note('limiter_penalize', () =>
        this.deps.limiter.penalize(call.bucket, t + wait + 500, t, this.intervalOf(call.bucket)),
      );
      await this.note('breaker_release', () => breakers.release(source, t));
      metrics.record(t, 'rate_limited', ms, 'rate_limited');
      throw new SourceError('SOURCE_RATE_LIMITED', null, { source, retryAfterMs: wait + 500 });
    }
    if (res.status === 418 || res.body.includes(WAF_MARKER)) {
      await this.note('breaker_waf', () => breakers.onWaf(source, t));
      metrics.record(t, 'error', ms, 'waf_blocked');
      throw new SourceError('SOURCE_UNAVAILABLE', 'waf_blocked', { source });
    }
    if (res.status >= 500) {
      await this.note('breaker_failure', () => breakers.onFailure(source, t, 'upstream_5xx'));
      metrics.record(t, 'error', ms, 'upstream_5xx');
      return this.retryOr(
        call,
        tryNo,
        new SourceError('SOURCE_UNAVAILABLE', 'upstream_5xx', { source }),
      );
    }
    if (res.status === 404) {
      await this.note('breaker_release', () => breakers.release(source, t));
      metrics.record(t, 'ok', ms);
      throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source });
    }
    if (res.status >= 400) {
      await this.note('breaker_release', () => breakers.release(source, t));
      metrics.record(t, 'error', ms, 'upstream_4xx');
      throw new SourceError('SOURCE_UNAVAILABLE', 'upstream_4xx', { source });
    }
    await this.note('breaker_success', () => breakers.onSuccess(source, t));
    metrics.record(t, 'ok', ms);
    return res;
  }

  private async retryOr(
    call: GatewayCall,
    tryNo: number,
    err: SourceError,
  ): Promise<UpstreamResponse> {
    if (tryNo >= this.deps.cfg.retries) throw err;
    let gate: Awaited<ReturnType<BreakerStore['allow']>>;
    try {
      gate = await this.deps.breakers.allow(call.source, this.deps.now());
    } catch {
      this.deps.reportDegraded('breaker_allow');
      throw err;
    }
    if (!gate.ok) throw err;
    await this.deps.sleep(200 + Math.floor(this.deps.random() * 600));
    try {
      await this.acquire(call);
    } catch {
      await this.note('breaker_release', () =>
        this.deps.breakers.release(call.source, this.deps.now()),
      );
      throw err;
    }
    return this.attempt(call, tryNo + 1);
  }
}
