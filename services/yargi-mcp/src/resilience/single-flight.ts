// Tek uçuş (021 §5.9): önce süreç içi söz haritası, sonra replikalar arası valkey-cache kilidi
// `SET eda:sf:<sha256> <rastgele> NX PX sources.singleFlightLockMs`. Kilidi alamayan, önbelleği kilit
// süresince 200 ms aralıkla yoklar; dolmazsa kendi çağrısını yapar (tools/cached.ts). Kilidi yalnız
// sahibi bırakır (`single-flight.lua`). Kilit değeri rastgele belirteçtir; sorgu içermez.
import { randomUUID } from 'node:crypto';
import { VALKEY_CACHE_KEYS } from '@eda/contracts/mcp';
import { loadLua, runLua, type ValkeyClient } from './valkey.ts';

/** 021 §5.9: kilidi alamayanın önbellek yoklama aralığı. */
export const SINGLE_FLIGHT_POLL_MS = 200;

/** Aynı anahtar için uçuştaki tek söz (süreç içi). */
export class SingleFlight {
  private readonly inflight = new Map<string, Promise<unknown>>();

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

export interface FlightLock {
  /** Kilit alındıysa sahiplik belirteci, başka replikadaysa `null`. */
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}

const RELEASE = loadLua('single-flight');

export class ValkeyFlightLock implements FlightLock {
  private readonly client: ValkeyClient;

  constructor(client: ValkeyClient) {
    this.client = client;
  }

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const res = await this.client.set(
      VALKEY_CACHE_KEYS.singleFlight(key),
      token,
      'PX',
      Math.max(1, ttlMs),
      'NX',
    );
    return res === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await runLua(this.client, RELEASE, [VALKEY_CACHE_KEYS.singleFlight(key)], [token]);
  }
}
