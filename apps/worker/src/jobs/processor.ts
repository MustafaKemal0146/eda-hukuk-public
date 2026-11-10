// `maintenance` kuyruğu işleyici dağıtıcısı (043 §3.1, §5.2, §5.3, §7.2): iş adı kayıt defterinde ve bu
// kuyrukta olmalı; yük strict şemayla doğrulanır (geçersizse kalıcı hata, `UnrecoverableError`);
// dakikalık zamanlayıcı işi bayatsa atlanır; işleyici `jobs.timeoutSec.<sınıf>` ile zaman kutusuna
// alınır (aşım geçici hatadır, yeniden denenir). Günlük bağlamı yalnız kuyruk, iş, jobId, deneme,
// requestId ve schedulerId taşır; yük ve sonuç loglanmaz.
import {
  isJobName,
  JOBS,
  type JobDef,
  type JobName,
  JobPayloadError,
  parseJobPayload,
  type QueueName,
  timeoutMs,
} from '@eda/contracts/queues';
import type { EdaLogger } from '@eda/observability/logger';
import { UnrecoverableError } from 'bullmq';
import type { Metrics } from '../metrics.ts';
import { isStaleTick, type ScheduledJobTiming, staleIntervalMs } from './stale.ts';

export interface JobHandlerContext {
  readonly signal: AbortSignal;
}
export type JobHandler = (ctx: JobHandlerContext) => Promise<unknown>;

/** BullMQ `Job`'un kullanılan alt kümesi. */
export interface ProcessableJob extends ScheduledJobTiming {
  readonly name: string;
  readonly id?: string | undefined;
  readonly data: unknown;
  readonly attemptsMade: number;
  readonly queueName: string;
}

export interface ProcessorDeps {
  readonly queue: QueueName;
  readonly handlers: Partial<Record<JobName, JobHandler>>;
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly now?: () => number;
  /** Test: sınıf süresi yerine verilen süre. */
  readonly timeoutOverrideMs?: number;
}

export class JobTimeoutError extends Error {
  override name = 'JobTimeoutError';
}

export type ProcessOutcome =
  | { readonly status: 'done'; readonly result: unknown }
  | { readonly status: 'skipped_stale' };

async function runWithTimeout(handler: JobHandler, ms: number, name: string): Promise<unknown> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Önce ret: iptal sinyaline yanıt veren işleyici yarışı kazanmasın.
      reject(new JobTimeoutError(`iş zaman aşımına uğradı: ${name}`));
      controller.abort();
    }, ms);
  });
  try {
    return await Promise.race([handler({ signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createProcessor(
  deps: ProcessorDeps,
): (job: ProcessableJob) => Promise<ProcessOutcome> {
  const now = deps.now ?? Date.now;
  return async (job) => {
    const name = job.name;
    const handler = isJobName(name) ? deps.handlers[name] : undefined;
    if (!isJobName(name) || handler === undefined || JOBS[name].queue !== deps.queue) {
      throw new UnrecoverableError(`bu kuyrukta kayıtlı olmayan iş: ${name}`);
    }
    if (job.queueName !== deps.queue) {
      throw new UnrecoverableError(`iş beklenmeyen kuyruktan geldi: ${name}`);
    }
    let payload: { readonly requestId?: string | undefined };
    try {
      payload = parseJobPayload(name, job.data);
    } catch (err) {
      if (err instanceof JobPayloadError) throw new UnrecoverableError(err.message);
      throw err;
    }
    const def: JobDef = JOBS[name];
    const ctx = {
      queue: deps.queue,
      job: name,
      jobId: job.id,
      attempt: job.attemptsMade + 1,
      ...(payload.requestId === undefined ? {} : { requestId: payload.requestId }),
      ...(job.repeatJobKey === undefined ? {} : { schedulerId: job.repeatJobKey }),
    };
    const started = now();
    if (def.scheduler !== undefined) {
      const interval = staleIntervalMs(def.scheduler.pattern);
      if (interval !== undefined && isStaleTick(job, interval, started)) {
        deps.metrics.inc('eda_job_skipped_stale_total', { job: name });
        deps.logger.info({ ...ctx, outcome: 'skipped_stale' }, 'bayat zamanlayıcı tiki atlandı');
        return { status: 'skipped_stale' };
      }
      deps.metrics.set('eda_scheduler_last_run_timestamp', Math.floor(started / 1000), {
        job: name,
      });
    }
    const limit = deps.timeoutOverrideMs ?? timeoutMs(def.timeoutClass);
    try {
      const result = await runWithTimeout(handler, limit, name);
      deps.logger.info({ ...ctx, outcome: 'ok', durationMs: now() - started }, 'iş tamamlandı');
      return { status: 'done', result };
    } catch (err) {
      deps.logger.warn(
        {
          ...ctx,
          outcome: 'failed',
          durationMs: now() - started,
          err: err instanceof Error ? err.name : 'unknown',
        },
        'iş başarısız',
      );
      throw err;
    }
  };
}
