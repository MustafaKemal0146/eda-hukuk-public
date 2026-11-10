// Dosya hattı BullMQ üreticisi (043 §2.3, §12; 033 §6.4): yalnız `add`. Kuyruğa alma DB işlemi commit
// edildikten sonra yapılır (`tx.afterCommit`); ekleme hatası isteği başarısız saymaz: dosya `uploaded`
// kalır ve telafi (`pending_files.sweep`) sonraki dilimdedir. Yük yalnız kimlik taşır (dosya adı YOK).
import { fileJobId } from '@eda/contracts/jobs/files';
import { BULLMQ_PREFIX, jobDefaults, parseJobPayload } from '@eda/contracts/queues';
import type { EdaLogger } from '@eda/observability/logger';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

/** `files-batch` öncelik değeri (043 §4, 033 §7.3). */
const BATCH_PRIORITY = 10;

export interface FileScanRequest {
  readonly orgId: string;
  readonly fileId: string;
  readonly userId: string;
  /** `batch=true` ile yüklenenlerin tüm adımları `files-batch`. */
  readonly batch: boolean;
  /** `files.updated_at` saniyesi: yeniden işleme yeni `jobId` alır. */
  readonly epochSec: number;
  readonly requestId?: string | undefined;
}

export interface FileJobProducer {
  addFileScan(req: FileScanRequest): Promise<void>;
  readonly failedCount: () => number;
  close(): Promise<void>;
}

export function createFileJobProducer(connection: Redis, logger: EdaLogger): FileJobProducer {
  const interactive = new Queue('files-interactive', { connection, prefix: BULLMQ_PREFIX });
  const batch = new Queue('files-batch', { connection, prefix: BULLMQ_PREFIX });
  interactive.on('error', () => undefined);
  batch.on('error', () => undefined);
  let failed = 0;
  return {
    async addFileScan(req) {
      const data = parseJobPayload('file.scan', {
        v: 1,
        orgId: req.orgId,
        fileId: req.fileId,
        userId: req.userId,
        ...(req.requestId === undefined ? {} : { requestId: req.requestId }),
      });
      const defaults = jobDefaults('file.scan');
      try {
        await (req.batch ? batch : interactive).add('file.scan', data, {
          jobId: fileJobId('file.scan', req.fileId, req.epochSec),
          priority: req.batch ? BATCH_PRIORITY : defaults.priority,
          attempts: defaults.attempts,
          backoff: defaults.backoff,
          removeOnComplete: defaults.removeOnComplete,
          removeOnFail: defaults.removeOnFail,
        });
      } catch {
        failed += 1;
        logger.error({ event: 'queue.enqueue_failed', job: 'file.scan', requestId: req.requestId });
      }
    },
    failedCount: () => failed,
    close: async () => {
      await Promise.all([interactive.close(), batch.close()]);
    },
  };
}
