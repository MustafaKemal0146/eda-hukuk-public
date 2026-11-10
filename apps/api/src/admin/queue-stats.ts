// Kuyruk sayaçları (Sistem modülü): kuyruk başına bekleyen/aktif/başarısız/geciken sayısı. Yalnız
// `getJobCounts`; iş yükü okunmaz. Meta yazımı kapalıdır (`skipMetasUpdate`): salt okur. Bağlantı
// admin yüzeyinin mevcut BullMQ üretici bağlantısıdır (`queueRedis`).
import type { QueueName } from '@eda/contracts/config/env';
import { BULLMQ_PREFIX } from '@eda/contracts/queues';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import type { QueueCounts } from './system-service.ts';

export interface QueueStats {
  counts(queue: QueueName): Promise<QueueCounts>;
  close(): Promise<void>;
}

export function createQueueStats(connection: Redis): QueueStats {
  const queues = new Map<QueueName, Queue>();
  const of = (name: QueueName): Queue => {
    let q = queues.get(name);
    if (q === undefined) {
      q = new Queue(name, { connection, prefix: BULLMQ_PREFIX, skipMetasUpdate: true });
      q.on('error', () => undefined);
      queues.set(name, q);
    }
    return q;
  };
  return {
    async counts(name) {
      const c = await of(name).getJobCounts('waiting', 'active', 'failed', 'delayed');
      return {
        waiting: c.waiting ?? 0,
        active: c.active ?? 0,
        failed: c.failed ?? 0,
        delayed: c.delayed ?? 0,
      };
    },
    close: async () => {
      await Promise.all([...queues.values()].map((q) => q.close().catch(() => undefined)));
      queues.clear();
    },
  };
}
