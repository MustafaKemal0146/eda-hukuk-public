// Kaynak başına süreç içi sayaçlar (021 §5.14): son 1 saat penceresi; yeniden başlatmada sıfırlanır.
const HOUR_MS = 3_600_000;
const DEGRADED_WINDOW_MS = 15 * 60_000;

type Kind = 'ok' | 'error' | 'rate_limited' | 'timeout' | 'cache_hit';
type Event = { at: number; kind: Kind; ms: number | null };

export class SourceMetrics {
  private events: Event[] = [];
  lastSuccessAt: number | null = null;
  lastFailureAt: number | null = null;
  lastErrorReason: string | null = null;

  record(now: number, kind: Kind, ms: number | null = null, reason: string | null = null): void {
    this.events.push({ at: now, kind, ms });
    if (kind === 'ok') this.lastSuccessAt = now;
    if (kind === 'error' || kind === 'timeout' || kind === 'rate_limited') {
      this.lastFailureAt = now;
      this.lastErrorReason = reason ?? kind;
    }
    this.prune(now);
  }

  counters(now: number): {
    requests: number;
    errors: number;
    rate_limited: number;
    cache_hits: number;
    p95_ms: number | null;
  } {
    this.prune(now);
    const upstream = this.events.filter((e) => e.kind !== 'cache_hit');
    const durations = upstream
      .map((e) => e.ms)
      .filter((m): m is number => m !== null)
      .sort((a, b) => a - b);
    const p95 =
      durations.length > 0
        ? (durations[Math.min(durations.length - 1, Math.ceil(durations.length * 0.95) - 1)] ??
          null)
        : null;
    return {
      requests: upstream.length,
      errors: upstream.filter((e) => e.kind === 'error' || e.kind === 'timeout').length,
      rate_limited: upstream.filter((e) => e.kind === 'rate_limited').length,
      cache_hits: this.events.length - upstream.length,
      p95_ms: p95 === null ? null : Math.round(p95),
    };
  }

  /** Son 15 dk'da 429/zaman aşımı oranı (yüzde). */
  degradedPct(now: number): number {
    const recent = this.events.filter(
      (e) => e.kind !== 'cache_hit' && e.at >= now - DEGRADED_WINDOW_MS,
    );
    if (recent.length === 0) return 0;
    const bad = recent.filter((e) => e.kind === 'rate_limited' || e.kind === 'timeout').length;
    return (bad * 100) / recent.length;
  }

  private prune(now: number): void {
    const from = now - HOUR_MS;
    let i = 0;
    while (i < this.events.length && (this.events[i]?.at ?? now) < from) i += 1;
    if (i > 0) this.events = this.events.slice(i);
  }
}
