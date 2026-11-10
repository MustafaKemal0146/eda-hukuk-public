// Önbellekler (021 §5.9): arama / mevzuat sonuçları valkey-cache `eda:src:<kaynak>:<sha256>` anahtarında
// (Valkey TTL = 2 × tazelik, değer içinde `fresh_until`); belge tamponu, künye ve portal kimlikleri süreç
// içi TTL + LRU'dadır (karar tam metni Valkey'e yazılmaz, Y-41). Anahtar `eda-canon-v1` girdisinin
// SHA-256'sıdır; sorgu metni anahtarda da değerde de saklanmaz.
import { createHash } from 'node:crypto';
import { VALKEY_CACHE_KEYS } from '@eda/contracts/mcp';
import type { ValkeyClient } from './valkey.ts';

export type CacheEntry<V> = { value: V; storedAt: number; freshUntil: number; expiresAt: number };

export class TtlLru<V> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private bytes = 0;
  private readonly sizes = new Map<string, number>();
  readonly maxEntries: number;
  readonly maxBytes: number;

  constructor(maxEntries: number, maxBytes = Number.POSITIVE_INFINITY) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
  }

  get(key: string, now: number): CacheEntry<V> | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAt <= now) {
      this.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }

  /** `freshMs` tazelik; kayıt `staleMs` (≥ freshMs) sonunda silinir. */
  set(key: string, value: V, now: number, freshMs: number, staleMs: number, size = 0): void {
    this.delete(key);
    this.map.set(key, {
      value,
      storedAt: now,
      freshUntil: now + freshMs,
      expiresAt: now + staleMs,
    });
    this.sizes.set(key, size);
    this.bytes += size;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.delete(oldest);
    }
  }

  /** Kaydı hemen düşürür (bayat portal durumu gibi). */
  remove(key: string): void {
    this.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  private delete(key: string): void {
    if (!this.map.delete(key)) return;
    this.bytes -= this.sizes.get(key) ?? 0;
    this.sizes.delete(key);
  }
}

/** `eda-canon-v1`: anahtarları sıralı JSON → SHA-256 hex. */
export function canonKey(input: Record<string, unknown>): string {
  return createHash('sha256')
    .update(`eda-canon-v1:${canonJson(input)}`)
    .digest('hex');
}

function canonJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonJson(o[k])}`)
    .join(',')}}`;
}

/** Log korelasyonu: sorgu metni yerine SHA-256 ilk 12 hex (021 §5.15). */
export function queryHash(query: string): string {
  return createHash('sha256').update(query).digest('hex').slice(0, 12);
}

/** Paylaşılan sonuç kaydı: `storedAt` / `freshUntil` epoch ms. */
export type SharedEntry = { value: unknown; storedAt: number; freshUntil: number };

export interface ResultCache {
  get(source: string, key: string): Promise<SharedEntry | undefined>;
  /** `ttlMs` sonunda kayıt silinir (bayat dönüş penceresi); `freshMs` tazelik süresidir. */
  set(
    source: string,
    key: string,
    value: unknown,
    now: number,
    freshMs: number,
    ttlMs: number,
  ): Promise<void>;
}

function isSharedEntry(
  v: unknown,
): v is { v: 1; stored_at: number; fresh_until: number; value: unknown } {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.stored_at === 'number' &&
    typeof o.fresh_until === 'number' &&
    'value' in o
  );
}

/** valkey-cache sonuç önbelleği: GET / SET PX (ACL `~eda:src:*`). */
export class ValkeyResultCache implements ResultCache {
  private readonly client: ValkeyClient;

  constructor(client: ValkeyClient) {
    this.client = client;
  }

  async get(source: string, key: string): Promise<SharedEntry | undefined> {
    const raw = await this.client.get(VALKEY_CACHE_KEYS.sourceResult(source, key));
    if (raw === null) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (!isSharedEntry(parsed)) return undefined;
    return { value: parsed.value, storedAt: parsed.stored_at, freshUntil: parsed.fresh_until };
  }

  async set(
    source: string,
    key: string,
    value: unknown,
    now: number,
    freshMs: number,
    ttlMs: number,
  ): Promise<void> {
    const body = JSON.stringify({ v: 1, stored_at: now, fresh_until: now + freshMs, value });
    await this.client.set(
      VALKEY_CACHE_KEYS.sourceResult(source, key),
      body,
      'PX',
      Math.max(1, ttlMs),
    );
  }
}
