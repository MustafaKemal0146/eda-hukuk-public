// Ağsız birim testleri için dayanıklılık durumu ikizleri (yalnız test; üretimde süreç içi yedek yoktur).
// Kabul kuralları 021 §5.10 / §5.11 ile aynıdır; Lua uygulamasının kendisi gerçek valkey-cache'e karşı
// test/integration altında doğrulanır. `fail` bayrağı valkey-cache kesintisini taklit eder.
import { MCP_PRIORITIES, type McpPriority } from '@eda/contracts/mcp';
import type { SourcesConfig } from '../src/config/sources.ts';
import {
  BREAKER_MIN_REQUESTS,
  type BreakerSnapshot,
  type BreakerState,
  type BreakerStore,
} from '../src/resilience/breaker.ts';
import type { ResultCache, SharedEntry } from '../src/resilience/cache.ts';
import type {
  BucketSnapshot,
  RateLimiter,
  TakeParams,
  TakeResult,
} from '../src/resilience/rate-limit.ts';
import type { FlightLock } from '../src/resilience/single-flight.ts';
import type { ResilienceState } from '../src/resilience/state.ts';

export class Outage {
  down = false;
  check(): void {
    if (this.down) throw new Error('valkey-cache erişilemez (test)');
  }
}

type Counters = { g: number; d: number; w: number; ws: number };

export class MemoryRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; ts: number; pu: number }>();
  private readonly lq = new Map<McpPriority, Counters>();
  private readonly outage: Outage;

  constructor(outage: Outage) {
    this.outage = outage;
  }

  private counters(cls: McpPriority, now: number, win: number): Counters {
    const c = this.lq.get(cls) ?? { g: 0, d: 0, w: 0, ws: now };
    if (!this.lq.has(cls) || now - c.ws >= win) Object.assign(c, { g: 0, d: 0, ws: now });
    this.lq.set(cls, c);
    return c;
  }

  private bucket(id: string, now: number, interval: number) {
    const b = this.buckets.get(id) ?? { tokens: 1, ts: now, pu: 0 };
    b.tokens = Math.min(1, b.tokens + Math.max(0, now - b.ts) / interval);
    b.ts = now;
    this.buckets.set(id, b);
    return b;
  }

  async take(id: string, cls: McpPriority, now: number, p: TakeParams): Promise<TakeResult> {
    this.outage.check();
    const b = this.bucket(id, now, p.intervalMs);
    if (b.pu > now) return { ok: false, retryAfterMs: Math.ceil(b.pu - now), penalized: true };
    const [ci, cv, cg] = MCP_PRIORITIES.map((c) => this.counters(c, now, p.windowMs)) as [
      Counters,
      Counters,
      Counters,
    ];
    const mine = { interactive: ci, verify: cv, ingest: cg }[cls];
    const contention = cv.d + cg.d > 0;
    const wait = (1 - b.tokens) * p.intervalMs;
    const busy = (ms: number): TakeResult => {
      mine.d += 1;
      return { ok: false, retryAfterMs: Math.ceil(ms), penalized: false };
    };
    if (cls === 'interactive') {
      const total = ci.g + cv.g + cg.g;
      const capped = contention && total > 0 && ci.g / total >= p.sharePct / 100;
      if (b.tokens >= 1) {
        b.tokens -= 1;
        mine.g += 1;
        return { ok: true, waitMs: 0 };
      }
      if (!capped && wait <= p.maxWaitMs) {
        b.tokens -= 1;
        mine.g += 1;
        mine.w += 1;
        return { ok: true, waitMs: Math.ceil(wait) };
      }
      return busy(wait);
    }
    if (cls === 'ingest' && cv.d > 0) return busy(Math.max(wait, cv.ws + p.windowMs - now));
    if (b.tokens >= 1) {
      b.tokens -= 1;
      mine.g += 1;
      return { ok: true, waitMs: 0 };
    }
    return busy(wait);
  }

  async penalize(id: string, until: number, now: number, intervalMs: number): Promise<void> {
    this.outage.check();
    const b = this.bucket(id, now, intervalMs);
    b.pu = Math.max(b.pu, until);
  }

  async doneWaiting(cls: McpPriority): Promise<void> {
    this.outage.check();
    const c = this.lq.get(cls);
    if (c && c.w > 0) c.w -= 1;
  }

  async snapshot(id: string, now: number, intervalMs: number): Promise<BucketSnapshot> {
    this.outage.check();
    const b = this.buckets.get(id) ?? { tokens: 1, ts: now, pu: 0 };
    const tokens = Math.min(1, b.tokens + Math.max(0, now - b.ts) / intervalMs);
    const fill = b.pu > now ? 0 : Math.max(0, tokens);
    const w = (c: McpPriority) => this.lq.get(c)?.w ?? 0;
    return {
      fillPct: Math.round(fill * 100),
      pausedUntil: b.pu,
      waiting: { interactive: w('interactive'), verify: w('verify'), ingest: w('ingest') },
    };
  }
}

type Brk = {
  state: BreakerState;
  openedAt: number;
  openMs: number;
  consecutive: number;
  window: { at: number; ok: boolean }[];
  probe: boolean;
  reason: string | null;
};

export class MemoryBreakerStore implements BreakerStore {
  private readonly map = new Map<string, Brk>();
  private readonly cfg: () => SourcesConfig['breaker'];
  private readonly outage: Outage;

  constructor(cfg: () => SourcesConfig['breaker'], outage: Outage) {
    this.cfg = cfg;
    this.outage = outage;
  }

  private of(source: string): Brk {
    let b = this.map.get(source);
    if (!b) {
      b = {
        state: 'closed',
        openedAt: 0,
        openMs: this.cfg().openMs,
        consecutive: 0,
        window: [],
        probe: false,
        reason: null,
      };
      this.map.set(source, b);
    }
    return b;
  }

  private open(b: Brk, now: number, ms: number): void {
    Object.assign(b, { state: 'open', openedAt: now, openMs: ms, probe: false });
  }

  private push(b: Brk, now: number, ok: boolean): void {
    b.window.push({ at: now, ok });
    const from = now - this.cfg().windowMs;
    b.window = b.window.filter((e) => e.at >= from);
  }

  async allow(source: string, now: number) {
    this.outage.check();
    const b = this.of(source);
    if (b.state === 'open') {
      const left = b.openedAt + b.openMs - now;
      if (left > 0) return { ok: false as const, retryAfterMs: left };
      b.state = 'half_open';
      b.probe = false;
    }
    if (b.state === 'half_open') {
      if (b.probe) return { ok: false as const, retryAfterMs: null };
      b.probe = true;
    }
    return { ok: true as const };
  }

  async onSuccess(source: string, now: number): Promise<void> {
    this.outage.check();
    const b = this.of(source);
    this.push(b, now, true);
    b.consecutive = 0;
    if (b.state === 'half_open')
      Object.assign(b, { state: 'closed', openMs: this.cfg().openMs, probe: false });
  }

  async onFailure(source: string, now: number, reason: string): Promise<void> {
    this.outage.check();
    const b = this.of(source);
    const c = this.cfg();
    this.push(b, now, false);
    b.consecutive += 1;
    b.reason = reason;
    if (b.state === 'half_open') return this.open(b, now, Math.min(b.openMs * 2, c.openMaxMs));
    const errors = b.window.filter((e) => !e.ok).length;
    const rateTrip =
      b.window.length >= BREAKER_MIN_REQUESTS && (errors * 100) / b.window.length >= c.errorRatePct;
    if (b.consecutive >= c.consecutiveFailures || rateTrip) this.open(b, now, c.openMs);
  }

  async onWaf(source: string, now: number): Promise<void> {
    this.outage.check();
    const b = this.of(source);
    b.reason = 'waf_blocked';
    this.open(b, now, this.cfg().wafOpenMs);
  }

  async release(source: string): Promise<void> {
    this.outage.check();
    this.of(source).probe = false;
  }

  async snapshot(source: string, now: number): Promise<BreakerSnapshot> {
    this.outage.check();
    const b = this.of(source);
    if (b.state !== 'open') return { state: b.state, openUntil: null, reason: b.reason };
    const until = b.openedAt + b.openMs;
    return now >= until
      ? { state: 'half_open', openUntil: null, reason: b.reason }
      : { state: 'open', openUntil: until, reason: b.reason };
  }
}

export class MemoryResultCache implements ResultCache {
  readonly map = new Map<string, { entry: SharedEntry; expiresAt: number; json: string }>();
  private readonly now: () => number;
  private readonly outage: Outage;

  constructor(now: () => number, outage: Outage) {
    this.now = now;
    this.outage = outage;
  }

  async get(source: string, key: string): Promise<SharedEntry | undefined> {
    this.outage.check();
    const id = `${source}:${key}`;
    const e = this.map.get(id);
    if (!e || e.expiresAt <= this.now()) {
      this.map.delete(id);
      return undefined;
    }
    return { ...e.entry, value: JSON.parse(e.json) };
  }

  async set(
    source: string,
    key: string,
    value: unknown,
    now: number,
    freshMs: number,
    ttlMs: number,
  ) {
    this.outage.check();
    this.map.set(`${source}:${key}`, {
      entry: { value: null, storedAt: now, freshUntil: now + freshMs },
      expiresAt: now + ttlMs,
      json: JSON.stringify(value),
    });
  }
}

export class MemoryFlightLock implements FlightLock {
  readonly held = new Map<string, { token: string; until: number }>();
  private readonly now: () => number;
  private readonly outage: Outage;
  private n = 0;

  constructor(now: () => number, outage: Outage) {
    this.now = now;
    this.outage = outage;
  }

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    this.outage.check();
    const h = this.held.get(key);
    if (h && h.until > this.now()) return null;
    const token = `t${++this.n}`;
    this.held.set(key, { token, until: this.now() + ttlMs });
    return token;
  }

  async release(key: string, token: string): Promise<void> {
    this.outage.check();
    if (this.held.get(key)?.token === token) this.held.delete(key);
  }
}

export type MemoryState = ResilienceState & {
  outage: Outage;
  resultCache: MemoryResultCache;
  locks: MemoryFlightLock;
};

export function memoryState(cfg: SourcesConfig, now: () => number): MemoryState {
  const outage = new Outage();
  return {
    outage,
    limiter: new MemoryRateLimiter(outage),
    breakers: new MemoryBreakerStore(() => cfg.breaker, outage),
    resultCache: new MemoryResultCache(now, outage),
    locks: new MemoryFlightLock(now, outage),
  };
}
