// Kaynak token kovası ve öncelik sınıfları (021 §5.10): durum valkey-cache'te, kabul kararı
// `rate-limit.lua` içinde tek atomik EVALSHA ile verilir (çok replika). Kapasite 1, aralık
// `sources.<kaynak>.tokenIntervalMs`; `interactive` en çok `sources.interactiveMaxWaitMs` gelecek token
// rezerve eder, çekişme varken payı `sources.interactiveSharePct`'e ulaştıysa rezervasyon yapamaz;
// `verify`/`ingest` beklemez; `verify` reddedilmişse `ingest` alamaz. 429 cezası `pu` alanındadır.
// Valkey erişilemezse çağıran canlı isteği yapmaz (limiter_unavailable; fail-closed).
import { MCP_PRIORITIES, type McpPriority, VALKEY_CACHE_KEYS } from '@eda/contracts/mcp';
import { loadLua, runLua, type ValkeyClient } from './valkey.ts';

export type TakeResult =
  | { ok: true; waitMs: number }
  | { ok: false; retryAfterMs: number; penalized: boolean };

export type BucketSnapshot = {
  fillPct: number;
  pausedUntil: number;
  waiting: Record<McpPriority, number>;
};

/** Kabul parametreleri: çağrı anındaki etkin yapılandırmadan (eda:cfg:sources) gelir. */
export type TakeParams = {
  intervalMs: number;
  maxWaitMs: number;
  sharePct: number;
  windowMs: number;
};

export interface RateLimiter {
  take(bucket: string, priority: McpPriority, now: number, p: TakeParams): Promise<TakeResult>;
  /** 429: kova `until` anına dek dondurulur (Retry-After kırpılmış + 0,5 sn). */
  penalize(bucket: string, until: number, now: number, intervalMs: number): Promise<void>;
  /** Rezervasyon beklemesi bitti (`w` sayacı). */
  doneWaiting(priority: McpPriority): Promise<void>;
  snapshot(
    bucket: string,
    now: number,
    intervalMs: number,
    windowMs: number,
  ): Promise<BucketSnapshot>;
}

const SCRIPT = loadLua('rate-limit');

const classKeys = (): string[] => MCP_PRIORITIES.map((c) => VALKEY_CACHE_KEYS.priorityCounters(c));

function ints(raw: unknown, len: number): number[] {
  if (!Array.isArray(raw) || raw.length < len) throw new Error('rate-limit: beklenmeyen yanıt');
  return raw.map((v) => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) throw new Error('rate-limit: beklenmeyen yanıt');
    return n;
  });
}

export class ValkeyRateLimiter implements RateLimiter {
  private readonly client: ValkeyClient;

  constructor(client: ValkeyClient) {
    this.client = client;
  }

  private run(bucket: string, args: (string | number)[]): Promise<unknown> {
    return runLua(
      this.client,
      SCRIPT,
      [VALKEY_CACHE_KEYS.sourceBucket(bucket), ...classKeys()],
      args,
    );
  }

  async take(
    bucket: string,
    priority: McpPriority,
    now: number,
    p: TakeParams,
  ): Promise<TakeResult> {
    const raw = await this.run(bucket, [
      'take',
      now,
      p.intervalMs,
      priority,
      p.maxWaitMs,
      p.sharePct,
      p.windowMs,
    ]);
    const [granted, ms, kind] = ints(raw, 2);
    if (granted === 1) return { ok: true, waitMs: ms ?? 0 };
    return { ok: false, retryAfterMs: ms ?? 0, penalized: kind === 1 };
  }

  async penalize(bucket: string, until: number, now: number, intervalMs: number): Promise<void> {
    await this.run(bucket, ['penalize', now, intervalMs, until]);
  }

  async doneWaiting(priority: McpPriority): Promise<void> {
    // Kova anahtarı kullanılmaz; script yalnız sınıf sayacına dokunur (KEYS listesi sabit kalır).
    await this.run('_', ['done', priority]);
  }

  async snapshot(
    bucket: string,
    now: number,
    intervalMs: number,
    windowMs: number,
  ): Promise<BucketSnapshot> {
    const [tokens, pu, wi, wv, wg] = ints(
      await this.run(bucket, ['peek', now, intervalMs, windowMs]),
      5,
    );
    const fill = (pu ?? 0) > now ? 0 : Math.max(0, Math.min(1, tokens ?? 0));
    return {
      fillPct: Math.round(fill * 100),
      pausedUntil: pu ?? 0,
      waiting: { interactive: wi ?? 0, verify: wv ?? 0, ingest: wg ?? 0 },
    };
  }
}

/** Retry-After (saniye veya HTTP tarihi) → ms; [1, max] sn aralığına kırpılır (021 §5.7.1). */
export function retryAfterMs(
  header: string | undefined,
  defaultSec: number,
  maxSec: number,
  now: number,
): number {
  let sec = defaultSec;
  if (header !== undefined) {
    const n = Number(header.trim());
    if (Number.isFinite(n)) sec = n;
    else {
      const at = Date.parse(header);
      if (Number.isFinite(at)) sec = (at - now) / 1000;
    }
  }
  return Math.round(Math.min(maxSec, Math.max(1, sec)) * 1000);
}

/**
 * Kaynak başına eşzamanlılık (`sources.perSourceConcurrency`; 021 §5.10 "ek semafor"). 002 §18'de
 * bunun için Valkey anahtarı yoktur: replika başınadır. Sınır her girişte yeniden okunur.
 */
export class Semaphore {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly limit: () => number;

  constructor(limit: () => number) {
    this.limit = limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.limit()) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }
}
