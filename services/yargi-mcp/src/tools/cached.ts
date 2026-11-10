// Önbellek + tek uçuş + bayat sonuç (021 §5.9): taze kayıt (valkey-cache `eda:src:`) doğrudan döner;
// değilse süreç içi tek uçuş, ardından replikalar arası `eda:sf:` kilidi. Kilidi başka replika tutuyorsa
// önbellek kilit süresince 200 ms aralıkla yoklanır, dolmazsa kendi çağrısı yapılır. Portal başarısızsa
// (erişilemez, yoğun, oran sınırı, devre açık) ve bayat kayıt varsa status "stale" + stale_as_of.
// valkey-cache okunamıyorsa kayıt yok sayılır; canlı çağrıyı ağ geçidi fail-closed reddeder.
import type { SourceCode } from '@eda/contracts/enums';
import type { SharedEntry } from '../resilience/cache.ts';
import { SINGLE_FLIGHT_POLL_MS } from '../resilience/single-flight.ts';
import { isoDay } from '../sources/dates.ts';
import { SourceError } from '../sources/errors.ts';
import type { ToolDeps } from './context.ts';

const STALE_OK = new Set(['SOURCE_UNAVAILABLE', 'SOURCE_BUSY', 'SOURCE_RATE_LIMITED']);

export type Cached<T> = { value: T; cached: boolean; staleAsOf: string | null };

async function read(
  deps: ToolDeps,
  source: SourceCode,
  key: string,
): Promise<SharedEntry | undefined> {
  try {
    return await deps.resultCache.get(source, key);
  } catch {
    deps.reportDegraded('cache_get');
    return undefined;
  }
}

async function fetchShared<T>(
  deps: ToolDeps,
  source: SourceCode,
  key: string,
  freshMs: number,
  fetcher: () => Promise<T>,
): Promise<{ value: T; peer: boolean }> {
  const lockMs = deps.cfg.singleFlightLockMs;
  let token: string | null = null;
  let heldElsewhere = false;
  try {
    token = await deps.locks.acquire(key, lockMs);
    heldElsewhere = token === null;
  } catch {
    deps.reportDegraded('single_flight_lock');
  }
  if (heldElsewhere) {
    const deadline = deps.now() + lockMs;
    while (deps.now() < deadline) {
      await deps.sleep(SINGLE_FLIGHT_POLL_MS);
      const e = await read(deps, source, key);
      if (e && e.freshUntil > deps.now()) return { value: e.value as T, peer: true };
    }
  }
  try {
    const value = await fetcher();
    try {
      await deps.resultCache.set(source, key, value, deps.now(), freshMs, freshMs * 2);
    } catch {
      deps.reportDegraded('cache_set');
    }
    return { value, peer: false };
  } finally {
    if (token !== null) {
      const owned = token;
      await deps.locks
        .release(key, owned)
        .catch(() => deps.reportDegraded('single_flight_release'));
    }
  }
}

export async function cachedFetch<T>(
  deps: ToolDeps,
  source: SourceCode,
  key: string,
  freshMs: number,
  fetcher: () => Promise<T>,
): Promise<Cached<T>> {
  const now = deps.now();
  const entry = await read(deps, source, key);
  if (entry && entry.freshUntil > now) {
    deps.gateway.metricsOf(source).record(now, 'cache_hit');
    return { value: entry.value as T, cached: true, staleAsOf: null };
  }
  try {
    const out = await deps.flights.run(key, () => fetchShared(deps, source, key, freshMs, fetcher));
    if (out.peer) deps.gateway.metricsOf(source).record(deps.now(), 'cache_hit');
    return { value: out.value, cached: out.peer, staleAsOf: null };
  } catch (err) {
    if (entry && err instanceof SourceError && STALE_OK.has(err.code)) {
      return { value: entry.value as T, cached: true, staleAsOf: isoDay(entry.storedAt) };
    }
    throw err;
  }
}
