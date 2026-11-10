// Bayat tik atlama (043 §5.2, §10.1 madde 4): dakikalık zamanlayıcı işi, planlandığı andan
// `jobs.staleSkipFactor` x aralık sonra hâlâ başlamamışsa atlanır; kesinti sonrası birikmiş tik arka
// arkaya koşmaz. Planlanan an = `job.timestamp + job.delay` (zamanlayıcı işi bir önceki tikte gecikmeli
// eklenir).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';

const MINUTE_MS = 60_000;
/** 043 §9 dakikalık kalıp. */
export const MINUTELY_PATTERN = '* * * * *';

/** Bayat atlamanın uygulandığı aralık; yalnız dakikalık kalıplar için tanımlıdır. */
export function staleIntervalMs(pattern: string): number | undefined {
  return pattern === MINUTELY_PATTERN ? MINUTE_MS : undefined;
}

export interface ScheduledJobTiming {
  readonly timestamp: number;
  readonly delay: number;
  /** Zamanlayıcıdan gelen işte dolu (scheduler kimliği). */
  readonly repeatJobKey?: string | undefined;
}

export function isStaleTick(
  job: ScheduledJobTiming,
  intervalMs: number,
  nowMs: number,
  factor: number = CONFIG_DEFAULTS['jobs.staleSkipFactor'],
): boolean {
  if (job.repeatJobKey === undefined) return false;
  const dueAt = job.timestamp + Math.max(0, job.delay);
  return nowMs - dueAt > factor * intervalMs;
}
