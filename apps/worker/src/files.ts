// `files-interactive` / `files-batch` kuyruğu tüketicisi (043 §3.2, §11.1; 033 §7.2). `file.scan` ve
// `file.extract` (P21 ilk dilimi): temiz taramadan sonra `file.extract` aynı kuyruğa alınır.
// `file.ocr/chunk/embed/card` ilgili dilimlerde eklenir ve kayıtlı olmayan iş kalıcı hatadır. Yük strict şemayla doğrulanır (yalnız kimlikler). Altyapı kesintisi gecikmeli
// yeniden denemedir ve deneme tüketmez (`moveToDelayed`).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EnvOf } from '@eda/contracts/config/env';
import { fileJobId } from '@eda/contracts/jobs/files';
import {
  BULLMQ_PREFIX,
  JobPayloadError,
  jobDefaults,
  parseJobPayload,
} from '@eda/contracts/queues';
import { parseKekFile } from '@eda/crypto';
import { withTenant } from '@eda/db';
import { createKeyring } from '@eda/db/keyring';
import { createObjectStore, createS3Client } from '@eda/db/s3';
import type { EdaLogger } from '@eda/observability/logger';
import { DelayedError, type Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { createClamdScanner } from './files/clamd.ts';
import { createDocEngineClient } from './files/doc-engine.ts';
import type { Metrics } from './metrics.ts';
import { type FileExtractDeps, processFileExtract } from './processors/files/file-extract.ts';
import {
  type FileScanDeps,
  isPermanentContextError,
  processFileScan,
} from './processors/files/file-scan.ts';

export const FILE_QUEUES = ['files-interactive', 'files-batch'] as const;
export type FileQueue = (typeof FILE_QUEUES)[number];

export interface FileJobView {
  readonly name: string;
  readonly data: unknown;
  readonly timestamp: number;
  readonly attemptsMade: number;
  /** Her çalıştırmada artar (ertelenen iş dahil); erteleme gecikmesi buna göre büyür. */
  readonly attemptsStarted?: number;
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

/** Temiz taramadan sonra `file.extract` kuyruğa alınır (yük yalnız kimlik). */
export type EnqueueExtract = (req: {
  readonly orgId: string;
  readonly fileId: string;
  readonly userId: string;
}) => Promise<void>;

export interface FilesHandlerDeps {
  readonly scan: FileScanDeps;
  /** Verilmezse `file.extract` kalıcı hatadır (doc-engine yapılandırılmamış). */
  readonly extract?: FileExtractDeps;
  readonly enqueueExtract?: EnqueueExtract;
}

type FilePayload = { orgId: string; fileId: string; userId: string };

function payloadOf(name: 'file.scan' | 'file.extract', data: unknown): FilePayload {
  try {
    return parseJobPayload(name, data);
  } catch (err) {
    if (err instanceof JobPayloadError) throw new UnrecoverableError(err.message);
    throw err;
  }
}

/** İş işleyicisi (test edilebilir; BullMQ'dan bağımsız alt küme). */
export function createFilesHandler(deps: FilesHandlerDeps) {
  return async (job: FileJobView, token?: string) => {
    if (job.name !== 'file.scan' && job.name !== 'file.extract') {
      throw new UnrecoverableError(`bu kuyrukta kayıtlı olmayan iş: ${job.name}`);
    }
    const payload = payloadOf(job.name, job.data);
    const view = {
      ...payload,
      deferrals: job.attemptsStarted ?? job.attemptsMade,
      enqueuedAt: new Date(job.timestamp),
    };
    let outcome:
      | Awaited<ReturnType<typeof processFileScan>>
      | Awaited<ReturnType<typeof processFileExtract>>;
    try {
      if (job.name === 'file.scan') {
        outcome = await processFileScan(view, deps.scan);
      } else {
        if (deps.extract === undefined) {
          throw new UnrecoverableError('doc-engine yapılandırılmamış');
        }
        outcome = await processFileExtract(view, deps.extract);
      }
    } catch (err) {
      if (isPermanentContextError(err)) throw new UnrecoverableError('yükleyen büro üyesi değil');
      throw err;
    }
    if (outcome.status === 'deferred') {
      await job.moveToDelayed(outcome.untilMs, token);
      throw new DelayedError();
    }
    if (outcome.status === 'gave_up') throw new UnrecoverableError(outcome.reason);
    if (
      job.name === 'file.scan' &&
      // `already_scanned`: önceki denemede kuyruğa alma başarısız olduysa evrak `extracting`te
      // kalmasın; çıkarma işi durum korumalıdır (ikinci kopya iş yapmaz).
      (outcome.status === 'clean' ||
        outcome.status === 'clean_unscanned' ||
        (outcome.status === 'skipped' && outcome.reason === 'already_scanned')) &&
      deps.enqueueExtract !== undefined
    ) {
      await deps.enqueueExtract({
        orgId: payload.orgId,
        fileId: payload.fileId,
        userId: payload.userId,
      });
    }
    return outcome;
  };
}

export function startFilesWorkers(
  env: EnvOf<'worker'>,
  queues: readonly FileQueue[],
  redis: Redis,
  logger: EdaLogger,
  metrics: Metrics,
): Worker[] {
  const secret = (path: string): string => readFileSync(path, 'utf8').replace(/\r?\n$/, '');
  const kek = parseKekFile(readFileSync(env.KEK_MASTER_FILE, 'utf8'));
  const store = createObjectStore(
    createS3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      credentials: {
        accessKeyId: secret(env.S3_ACCESS_KEY_ID_FILE),
        secretAccessKey: secret(env.S3_SECRET_ACCESS_KEY_FILE),
      },
    }),
    env.S3_BUCKET_FILES,
  );
  const keyring = createKeyring({ keks: [{ kek: kek.kek, kekVersion: kek.kekVersion }] });
  // Sohbet eki ve etkileşimli evrak `files-interactive`'e (033 §7.3); jobId epoch'u kuyruğa alma anı.
  const interactive = new Queue('files-interactive', { connection: redis, prefix: BULLMQ_PREFIX });
  interactive.on('error', () => undefined);
  const enqueueExtract: EnqueueExtract = async (req) => {
    const defaults = jobDefaults('file.extract');
    await interactive.add('file.extract', parseJobPayload('file.extract', { v: 1, ...req }), {
      jobId: fileJobId('file.extract', req.fileId, Math.floor(Date.now() / 1000)),
      priority: defaults.priority,
      attempts: defaults.attempts,
      backoff: defaults.backoff,
      removeOnComplete: defaults.removeOnComplete,
      removeOnFail: defaults.removeOnFail,
    });
  };
  const scanDeps: FileScanDeps = {
    db: { withTenant },
    store,
    keyring,
    scanner: env.CLAMAV_ENABLED
      ? createClamdScanner({
          host: env.CLAMAV_HOST,
          port: env.CLAMAV_PORT,
          timeoutMs: CONFIG_DEFAULTS['jobs.timeoutSec.standard'] * 1000,
        })
      : null,
    logger,
    metrics,
  };
  const handler = createFilesHandler({
    scan: scanDeps,
    extract: {
      db: { withTenant },
      store,
      keyring,
      docEngine: createDocEngineClient({
        baseUrl: env.DOC_ENGINE_URL,
        token: secret(env.DOC_ENGINE_TOKEN_FILE),
        timeoutMs: CONFIG_DEFAULTS['jobs.timeoutSec.heavy'] * 1000,
      }),
      logger,
      metrics,
      uuid: () => randomUUID(),
    },
    enqueueExtract,
  });
  return queues.map(
    (queue) =>
      new Worker(queue, (job: Job, token?: string) => handler(job, token), {
        connection: redis,
        prefix: BULLMQ_PREFIX,
        concurrency:
          queue === 'files-interactive'
            ? CONFIG_DEFAULTS['jobs.concurrency.filesInteractive']
            : CONFIG_DEFAULTS['jobs.concurrency.filesBatch'],
        lockDuration: CONFIG_DEFAULTS['jobs.lockDurationMs'],
        stalledInterval: CONFIG_DEFAULTS['jobs.stalledIntervalMs'],
        maxStalledCount: CONFIG_DEFAULTS['jobs.maxStalledCount'],
      }),
  );
}
