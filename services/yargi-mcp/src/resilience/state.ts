// Replikalar arası dayanıklılık durumu (021 §5.9–§5.11): kova, kesici, sonuç önbelleği, tek uçuş kilidi.
// Üretimde yalnız valkey-cache uygulaması kullanılır; süreç içi yedek yoktur (fail-closed).
import type { SourcesConfig } from '../config/sources.ts';
import { type BreakerStore, ValkeyBreakerStore } from './breaker.ts';
import { type ResultCache, ValkeyResultCache } from './cache.ts';
import { type RateLimiter, ValkeyRateLimiter } from './rate-limit.ts';
import { type FlightLock, ValkeyFlightLock } from './single-flight.ts';
import type { ValkeyClient } from './valkey.ts';

export type ResilienceState = {
  limiter: RateLimiter;
  breakers: BreakerStore;
  resultCache: ResultCache;
  locks: FlightLock;
};

export function valkeyState(client: ValkeyClient, cfg: SourcesConfig): ResilienceState {
  return {
    limiter: new ValkeyRateLimiter(client),
    breakers: new ValkeyBreakerStore(client, () => cfg.breaker),
    resultCache: new ValkeyResultCache(client),
    locks: new ValkeyFlightLock(client),
  };
}
