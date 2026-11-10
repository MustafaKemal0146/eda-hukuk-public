// source_status (021 §5.14): kesici ve kova durumu valkey-cache'ten (replikalar arası ortak), sayaçlar
// süreç içinden (021 §5.14: tek replika sayaçları). Portala istek atmaz. valkey-cache okunamıyorsa etkin
// kaynaklar `down` + `limiter_unavailable` raporlanır (canlı çağrı zaten yapılamaz). Dört MVP
// canlı kaynağın bağdaştırıcısı vardır (AS-P11-12 kapandı: anayasa , uyusmazlik ).
import type { SourceCode } from '@eda/contracts/enums';
import { MVP_LIVE_SOURCE_CODES } from '@eda/contracts/enums';
import type { McpSourceStatusResult, SourceStatusEntryValue } from '@eda/contracts/mcp';
import type { BreakerSnapshot } from '../resilience/breaker.ts';
import type { BucketSnapshot } from '../resilience/rate-limit.ts';
import { bucketOfSource } from '../sources/gateway.ts';
import type { ToolDeps } from './context.ts';

export const IMPLEMENTED_SOURCES: ReadonlySet<SourceCode> = new Set([
  'bedesten',
  'anayasa',
  'uyusmazlik',
  'mevzuat',
]);

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

const NO_WAITING = { interactive: 0, verify: 0, ingest: 0 };

async function shared(
  deps: ToolDeps,
  source: SourceCode,
): Promise<{ breaker: BreakerSnapshot; bucket: BucketSnapshot | null } | null> {
  try {
    const bucketName = bucketOfSource(source);
    return {
      breaker: await deps.gateway.breakerSnapshot(source),
      bucket: bucketName ? await deps.gateway.bucketSnapshot(bucketName) : null,
    };
  } catch {
    deps.reportDegraded('status_read');
    return null;
  }
}

export async function sourceStatus(deps: ToolDeps): Promise<McpSourceStatusResult> {
  const now = deps.now();
  const sources: SourceStatusEntryValue[] = [];
  for (const source of MVP_LIVE_SOURCE_CODES) {
    const enabled = deps.enabled.has(source) && IMPLEMENTED_SOURCES.has(source);
    const metrics = deps.gateway.metricsOf(source);
    const st = await shared(deps, source);
    if (st === null) {
      sources.push({
        source,
        enabled,
        state: enabled ? 'down' : 'disabled',
        breaker: 'closed',
        breaker_open_until: null,
        last_success_at: iso(metrics.lastSuccessAt),
        last_failure_at: iso(metrics.lastFailureAt),
        last_error_reason: enabled ? 'limiter_unavailable' : metrics.lastErrorReason,
        bucket_fill_pct: 0,
        waiting: { ...NO_WAITING },
        counters_1h: metrics.counters(now),
        last_canary: null,
      });
      continue;
    }
    const { breaker, bucket } = st;
    let state: SourceStatusEntryValue['state'] = 'up';
    if (!enabled) state = 'disabled';
    else if (breaker.state === 'open') state = 'down';
    else if (
      breaker.state === 'half_open' ||
      metrics.degradedPct(now) >= deps.cfg.degradedErrorPct
    ) {
      state = 'degraded';
    }
    const usedBucket = enabled ? bucket : null;
    sources.push({
      source,
      enabled,
      state,
      breaker: breaker.state,
      breaker_open_until: iso(breaker.openUntil),
      last_success_at: iso(metrics.lastSuccessAt),
      last_failure_at: iso(metrics.lastFailureAt),
      last_error_reason: metrics.lastErrorReason,
      bucket_fill_pct: usedBucket ? usedBucket.fillPct : 0,
      waiting: usedBucket ? { ...usedBucket.waiting } : { ...NO_WAITING },
      counters_1h: metrics.counters(now),
      last_canary: null,
    });
  }
  return { generated_at: new Date(now).toISOString(), sources };
}
