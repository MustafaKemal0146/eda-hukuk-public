// `email_outbox.sweep` işleyicisi (045 §6.2 madde 5, §6.6 basamak 5; 043 §9): `eda_jobs` ile bayat
// satırları bulur ve `notifications` kuyruğuna `jobId = deliveryId` ile yeniden ekler (idempotent).
// Aynı kimlikli iş başarısız kümede kalmışsa yeniden denenir, tamamlanmış kümede kalmışsa (satır yine
// de bekliyorsa) kaldırılıp yeniden eklenir. Yük yalnız `{ v, deliveryId }`.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { type EmailTemplateCode, emailJobOptions } from '@eda/contracts/notifications';
import { type JobsDb, runEmailOutboxSweep } from '@eda/db/jobs';
import type { EdaLogger } from '@eda/observability/logger';
import type { Metrics } from '../../metrics.ts';

/** BullMQ `Queue` / `Job` alt kümesi. */
export interface RequeueJob {
  getState(): Promise<string>;
  retry(state?: 'failed' | 'completed'): Promise<void>;
  remove(): Promise<void>;
}
export interface RequeueQueue {
  getJob(id: string): Promise<RequeueJob | undefined | null>;
  add(name: 'email.send', data: { v: 1; deliveryId: string }, opts: object): Promise<unknown>;
}

export interface EmailOutboxSweepDeps {
  readonly db: JobsDb;
  readonly queue: RequeueQueue;
  readonly logger: EdaLogger;
  readonly metrics: Metrics;
  readonly now?: () => Date;
}

export interface EmailOutboxSweepOutcome {
  readonly expired: number;
  readonly reset: number;
  readonly requeued: number;
}

export async function processEmailOutboxSweep(
  deps: EmailOutboxSweepDeps,
): Promise<EmailOutboxSweepOutcome> {
  const r = await runEmailOutboxSweep(deps.db, {
    staleMin: CONFIG_DEFAULTS['notifications.sweepStaleMin'],
    batchSize: CONFIG_DEFAULTS['jobs.rowBatchSize'],
    ...(deps.now === undefined ? {} : { now: deps.now() }),
  });
  let requeued = 0;
  for (const d of r.requeue) {
    const existing = await deps.queue.getJob(d.id);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed') {
        await existing.retry('failed');
        requeued += 1;
        continue;
      }
      if (state !== 'completed') continue; // bekliyor/çalışıyor/ertelenmiş: dokunulmaz
      await existing.remove();
    }
    await deps.queue.add(
      'email.send',
      { v: 1, deliveryId: d.id },
      emailJobOptions(d.id, d.class, d.templateCode as EmailTemplateCode),
    );
    requeued += 1;
  }
  if (requeued > 0) deps.metrics.inc('eda_email_requeued_total', undefined, requeued);
  return { expired: r.expired, reset: r.reset, requeued };
}
