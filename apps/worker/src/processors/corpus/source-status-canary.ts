// `source_status.canary` işleyicisi (021 §7.3; 043 §9 `corpus.source_status_canary`, günlük 05:00 TSİ).
// Beş yoklama yargi-mcp üzerinden SIRAYLA atılır (sabit, genel, kişisel veri içermeyen sorgular; kaynak
// başına günde en çok 2 istek). Her sonuç (`ok`/`empty`/`error`/`timeout`, süre ms) `corpus.source_canary_runs`
// tablosuna yazılır; `corpus.source_status.last_canary_*` güncellenir; pencere dışı satırlar silinir.
// Bozulma: yoklama art arda `sources.canaryFailThreshold` kez başarısızsa "bozuk"tur. E-posta yalnız DURUM
// DEĞİŞİMİNDE gider (bozuldu / düzeldi; spam yok): önceki durum aynı tablodaki geçmişten türetilir, ayrı
// durum deposu yoktur. Günlükte sorgu, yanıt ve hata metni yoktur; yalnız yoklama kodu, sonuç ve süre.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  SOURCE_CANARY_PROBES,
  type SourceCanaryOutcome,
  type SourceCanaryProbe,
  type SourceCode,
} from '@eda/contracts/enums';
import type { NoTenantTx } from '@eda/db';
import {
  type CanaryRunRow,
  insertCanaryRuns,
  markSourceCanary,
  purgeCanaryRuns,
  recentCanaryOutcomes,
} from '@eda/db/canary';
import type { SourceCanaryAlertInput } from '@eda/email/ops-alert';
import type { EdaLogger } from '@eda/observability/logger';
import type { Metrics } from '../../metrics.ts';

/** Yoklamanın ham sonucu: başarılıysa sonuç sayısı, değilse hata nedeni (yalnız kapalı küme). */
export type ProbeResult =
  | { readonly ok: true; readonly count: number; readonly stale: boolean }
  | { readonly ok: false; readonly reason: string | null };

export type ProbeCall = (signal: AbortSignal) => Promise<ProbeResult>;

/** Yoklama -> resmî kaynak kodu (`corpus.source_status` satırı). */
export const PROBE_SOURCE: Readonly<Record<SourceCanaryProbe, SourceCode>> = {
  uyap_search: 'bedesten',
  anayasa_search: 'anayasa',
  uyusmazlik_search: 'uyusmazlik',
  mevzuat_search: 'mevzuat',
  mevzuat_article: 'mevzuat',
};

export interface CanaryRecordInput {
  readonly runs: readonly CanaryRunRow[];
  /** Kaynak başına bu çalıştırmanın sonucu (tüm yoklamaları başarılı mı). */
  readonly sources: ReadonlyMap<SourceCode, boolean>;
  readonly checkedAt: Date;
  readonly purgeBefore: Date;
  /** Okunacak geçmiş derinliği (yoklama başına). */
  readonly historyDepth: number;
}

/**
 * Kalıcılık: tek işlemde ÖNCEKİ geçmişi okur (yoklama başına yeniden eskiye), yeni sonuçları yazar,
 * pencere dışını siler ve `source_status.last_canary_*` alanlarını günceller; önceki geçmişi döndürür.
 */
export interface CanaryStore {
  record(input: CanaryRecordInput): Promise<ReadonlyMap<string, readonly SourceCanaryOutcome[]>>;
}

export function dbCanaryStore(db: {
  withNoTenant<T>(reason: 'corpus', fn: (tx: NoTenantTx) => Promise<T>): Promise<T>;
}): CanaryStore {
  return {
    record: (input) =>
      db.withNoTenant('corpus', async (tx) => {
        const history = await recentCanaryOutcomes(tx, input.historyDepth);
        await insertCanaryRuns(tx, input.runs);
        await purgeCanaryRuns(tx, input.purgeBefore);
        for (const [source, ok] of input.sources) {
          await markSourceCanary(tx, source, input.checkedAt, ok);
        }
        return history;
      }),
  };
}

export interface CanaryDeps {
  readonly probes: Readonly<Record<SourceCanaryProbe, ProbeCall>>;
  readonly store: CanaryStore;
  /** Destek adresine işletim uyarısı (render + gönderim çağıranda). */
  readonly sendAlert: (input: SourceCanaryAlertInput) => Promise<void>;
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
  readonly tick?: () => number;
  /** Bekleme (test için enjekte edilebilir); varsayılan gerçek zamanlı. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly threshold?: number;
  readonly windowDays?: number;
}

export interface CanaryResult {
  readonly runs: readonly CanaryRunRow[];
  readonly degraded: readonly SourceCanaryProbe[];
  readonly recovered: readonly SourceCanaryProbe[];
}

export class CanaryAlertError extends Error {
  override name = 'CanaryAlertError';
}

export function classify(r: ProbeResult): SourceCanaryOutcome {
  if (!r.ok) return r.reason === 'timeout' ? 'timeout' : 'error';
  // `stale`: portal yanıt vermedi, önbellekten sunuldu -> kaynak çalışmıyor sayılır.
  if (r.stale) return 'error';
  return r.count > 0 ? 'ok' : 'empty';
}

/** Son `threshold` sonucun tamamı başarısızsa bozuk (geçmiş yeniden eskiye sıralı). */
export function isFailing(history: readonly SourceCanaryOutcome[], threshold: number): boolean {
  return history.length >= threshold && history.slice(0, threshold).every((o) => o !== 'ok');
}

const DAY_MS = 86_400_000;

/** MCP hız sınırlayıcısı yoklamayı bekletmeden geri çevirdi: kaynak bozuk değil, kuyruk dolu demektir. */
const LIMITER_BUSY_REASON = 'queue_wait_exceeded';

export async function runSourceCanary(deps: CanaryDeps): Promise<CanaryResult> {
  const now = deps.now ?? (() => new Date());
  const tick = deps.tick ?? (() => performance.now());
  const threshold = deps.threshold ?? CONFIG_DEFAULTS['sources.canaryFailThreshold'];
  const windowDays = deps.windowDays ?? CONFIG_DEFAULTS['sources.canaryWindowDays'];
  const signal = deps.signal ?? new AbortController().signal;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const call = async (probe: SourceCanaryProbe): Promise<ProbeResult> => {
    try {
      return await deps.probes[probe](signal);
    } catch {
      return { ok: false, reason: null };
    }
  };

  const runs: CanaryRunRow[] = [];
  for (const probe of SOURCE_CANARY_PROBES) {
    const t0 = tick();
    let result = await call(probe);
    // Aynı kaynağa art arda gelen yoklama (ör. mevzuat arama + madde) hız sınırlayıcıda reddedilebilir; bu
    // portal arızası sayılmaz. Sınırlayıcının kabul penceresi kadar bekleyip bir kez yeniden denenir.
    if (!result.ok && result.reason === LIMITER_BUSY_REASON) {
      await sleep(CONFIG_DEFAULTS['sources.interactiveMaxWaitMs']);
      result = await call(probe);
    }
    const outcome = classify(result);
    const durationMs = Math.max(0, Math.round(tick() - t0));
    runs.push({ probe, outcome, durationMs, checkedAt: now() });
    deps.logger.info({ event: 'source.canary', probe, outcome, duration_ms: durationMs });
  }

  const checkedAt = now();
  const sources = new Map<SourceCode, boolean>();
  for (const r of runs) {
    const src = PROBE_SOURCE[r.probe];
    sources.set(src, (sources.get(src) ?? true) && r.outcome === 'ok');
  }
  const history = await deps.store.record({
    runs,
    sources,
    checkedAt,
    purgeBefore: new Date(checkedAt.getTime() - windowDays * DAY_MS),
    historyDepth: threshold,
  });
  const degraded: SourceCanaryProbe[] = [];
  const recovered: SourceCanaryProbe[] = [];
  const failing = {} as Record<SourceCanaryProbe, boolean>;
  for (const r of runs) {
    const before = history.get(r.probe) ?? [];
    const was = isFailing(before, threshold);
    const is = isFailing([r.outcome, ...before], threshold);
    failing[r.probe] = is;
    if (!was && is) degraded.push(r.probe);
    if (was && !is) recovered.push(r.probe);
  }
  for (const [source, ok] of sources) {
    deps.metrics.set('eda_source_canary_ok', ok ? 1 : 0, { source });
  }

  // E-posta işlem DIŞINDA (ağ çağrısı DB işlemini tutmaz). Gönderim hatası işi başarısız kılar (kuyrukta
  // görünür); kayıtlar yazılmış olduğundan bir sonraki çalıştırma yeniden e-posta üretmez.
  let alertFailed = false;
  for (const [kind, changed] of [
    ['degraded', degraded],
    ['recovered', recovered],
  ] as const) {
    if (changed.length === 0) continue;
    try {
      await deps.sendAlert({ kind, changed, failing, threshold });
      deps.logger.info({ event: 'source.canary_alert', kind, probes: changed.length });
    } catch (err) {
      alertFailed = true;
      deps.logger.warn({
        event: 'source.canary_alert_failed',
        kind,
        err: err instanceof Error ? err.name : 'unknown',
      });
    }
  }
  if (alertFailed) throw new CanaryAlertError('kaynak durumu e-postası gönderilemedi');
  return { runs, degraded, recovered };
}
