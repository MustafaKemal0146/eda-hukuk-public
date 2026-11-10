// Süreç <-> kuyruk sahipliği (043 §1 madde 4, §2.2; KK-002-12). Env şeması aynı kuralı açılışta
// uygular; bu denetim ikinci savunmadır: `worker` `maintenance` tüketemez, `jobs` yalnız `maintenance`
// tüketir.
import { type QueueConsumer, type QueueName, queueConsumer } from '@eda/contracts/queues';

export class QueueOwnershipError extends Error {
  override name = 'QueueOwnershipError';
}

/** Sürecin tüketeceği kuyrukları doğrular ve döndürür; ihlalde `QueueOwnershipError`. */
export function assertConsumerQueues(
  service: QueueConsumer,
  queues: readonly QueueName[],
): readonly QueueName[] {
  if (queues.length === 0 || new Set(queues).size !== queues.length) {
    throw new QueueOwnershipError('WORKER_QUEUES boş veya yinelenen kuyruk içeriyor');
  }
  const foreign = queues.filter((q) => queueConsumer(q) !== service);
  if (foreign.length > 0) {
    throw new QueueOwnershipError(
      `${service} süreci şu kuyrukları tüketemez: ${foreign.join(', ')} (WORKER_QUEUES düzeltilmeli)`,
    );
  }
  return queues;
}
