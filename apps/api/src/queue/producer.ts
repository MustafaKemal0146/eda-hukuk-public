// BullMQ üreticisi (043 §2.3, §12; 045 §6.2): yalnız `add`. Kuyruğa alma DB işlemi commit edildikten
// sonra yapılır (`tx.afterCommit`); `jobId = deliveryId`, iş yükü yalnız `{ v, deliveryId, requestId? }`.
// Ekleme hatası isteği başarısız saymaz: `queue.enqueue_failed` günlüğü + sayaç; telafi
// `email_outbox.sweep`'tedir.
import {
  type EmailTemplateCode,
  emailJobOptions,
  type NotificationClass,
} from '@eda/contracts/notifications';
import { BULLMQ_PREFIX, parseJobPayload } from '@eda/contracts/queues';
import type { EdaLogger } from '@eda/observability/logger';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export interface EmailJobRequest {
  readonly deliveryId: string;
  readonly class: NotificationClass;
  readonly template: EmailTemplateCode;
  readonly requestId?: string | undefined;
}

export interface EmailProducer {
  addEmailSend(req: EmailJobRequest): Promise<void>;
  /** Başarısız ekleme sayısı (`eda_queue_enqueue_failed_total{job="email.send"}`). */
  readonly failedCount: () => number;
  close(): Promise<void>;
}

export function createEmailProducer(connection: Redis, logger: EdaLogger): EmailProducer {
  const queue = new Queue('notifications', { connection, prefix: BULLMQ_PREFIX });
  queue.on('error', () => undefined);
  let failed = 0;
  return {
    async addEmailSend(req) {
      const data = parseJobPayload('email.send', {
        v: 1,
        deliveryId: req.deliveryId,
        ...(req.requestId === undefined ? {} : { requestId: req.requestId }),
      });
      try {
        await queue.add(
          'email.send',
          data,
          emailJobOptions(req.deliveryId, req.class, req.template),
        );
      } catch {
        failed += 1;
        logger.error({
          event: 'queue.enqueue_failed',
          job: 'email.send',
          requestId: req.requestId,
        });
      }
    },
    failedCount: () => failed,
    close: () => queue.close(),
  };
}
