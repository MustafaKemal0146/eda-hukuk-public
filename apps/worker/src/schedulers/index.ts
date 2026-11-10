// Job Scheduler eşitlemesi (043 §9; KK-043-3 öncülü): kuyruğu tüketen süreç açılışta kayıt defterindeki
// her zamanlayıcıyı `upsertJobScheduler(id, { pattern, tz }, { name, data: { v: 1 }, opts })` ile kaydeder
// (idempotent) ve kayıt defterinde olmayanları siler. Eski repeat seçeneği ve repeatable API kullanılmaz.
import {
  type JobDefaults,
  type JobName,
  jobDefaults,
  type QueueName,
  schedulersOfQueue,
} from '@eda/contracts/queues';

/** BullMQ `Queue`'nun kullanılan alt kümesi. */
export interface SchedulerQueue {
  upsertJobScheduler(
    id: string,
    repeatOpts: { pattern: string; tz: string },
    template: { name: JobName; data: { v: 1 }; opts: JobDefaults },
  ): Promise<unknown>;
  getJobSchedulers(
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<readonly { key: string }[]>;
  removeJobScheduler(id: string): Promise<boolean>;
}

export interface SyncResult {
  readonly upserted: readonly string[];
  readonly removed: readonly string[];
}

export async function syncSchedulers(
  queue: SchedulerQueue,
  queueName: QueueName,
): Promise<SyncResult> {
  const wanted = schedulersOfQueue(queueName);
  const ids = new Set(wanted.map((w) => w.scheduler.id));
  for (const { name, scheduler } of wanted) {
    await queue.upsertJobScheduler(
      scheduler.id,
      { pattern: scheduler.pattern, tz: scheduler.tz },
      { name, data: { v: 1 }, opts: jobDefaults(name) },
    );
  }
  const removed: string[] = [];
  for (const existing of await queue.getJobSchedulers(0, -1)) {
    if (ids.has(existing.key)) continue;
    if (await queue.removeJobScheduler(existing.key)) removed.push(existing.key);
  }
  return { upserted: [...ids], removed };
}
