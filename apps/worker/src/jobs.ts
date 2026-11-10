// jobs girişi (dist/jobs.js; 043 §2.2, §13): yalnız `maintenance` kuyruğu ve zamanlayıcıları, `eda_jobs`
// (BYPASSRLS) rolüyle. Açılış: env + sır dosyaları -> kuyruk sahipliği -> PG rol güvencesi -> Valkey
// `noeviction` güvencesi -> zamanlayıcı eşitlemesi -> `Worker` -> :9464. Dış HTTP çağrısı yoktur
// (`HTTPS_PROXY` tanımsız); tek HTTP çağrısı `backup.verify`'ın iç ağdaki yedek durum ucudur. Kapanış: `draining` -> pause + `jobs.shutdownGraceSec` -> kuyruk, Valkey, PG.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { type EnvOf, JOBS_ONLY_QUEUE } from '@eda/contracts/config/env';
import { BULLMQ_PREFIX } from '@eda/contracts/queues';
import { JobsRoleError } from '@eda/db/jobs';
import { createLogger, type EdaLogger } from '@eda/observability/logger';
import { Queue, Worker } from 'bullmq';
import { load } from './config/load.ts';
import { assertConsumerQueues, QueueOwnershipError } from './config/queues.ts';
import { openJobsDb } from './db/jobs-pool.ts';
import { closeServer, startHealthServer } from './health/server.ts';
import { drainWorker } from './jobs/drain.ts';
import { createProcessor } from './jobs/processor.ts';
import { Metrics } from './metrics.ts';
import { processAuditSeal } from './processors/maintenance/audit-seal.ts';
import { processBackupVerify } from './processors/maintenance/backup-verify.ts';
import { processEmailOutboxSweep } from './processors/maintenance/email-outbox-sweep.ts';
import { syncSchedulers } from './schedulers/index.ts';
import { installShutdown } from './shutdown.ts';
import { assertNoEviction, createValkey, ValkeyPolicyError } from './valkey.ts';

const QUEUE = JOBS_ONLY_QUEUE;

/** Yalnız kendi hata sınıflarımızın (iç ayrıntısız, düzeltici) mesajı günlüğe yazılır. */
function errFields(err: unknown): Record<string, string> {
  if (!(err instanceof Error)) return { err: 'unknown' };
  const own =
    err instanceof QueueOwnershipError ||
    err instanceof ValkeyPolicyError ||
    err instanceof JobsRoleError;
  return own ? { err: err.name, reason: err.message } : { err: err.name };
}

async function start(env: EnvOf<'jobs'>, logger: EdaLogger): Promise<void> {
  assertConsumerQueues('jobs', env.WORKER_QUEUES);

  const db = await openJobsDb();

  const redis = createValkey(env, 'eda-jobs');
  redis.on('error', (err: unknown) => {
    logger.warn({ event: 'dependency.degraded', dependency: 'valkey', ...errFields(err) });
  });
  await redis.connect();
  await assertNoEviction(redis);

  const queue = new Queue(QUEUE, { connection: redis, prefix: BULLMQ_PREFIX });
  queue.on('error', (err: unknown) => {
    logger.warn({ event: 'dependency.degraded', dependency: 'valkey', ...errFields(err) });
  });
  const synced = await syncSchedulers(queue, QUEUE);
  logger.info(
    { event: 'config.loaded', queue: QUEUE, schedulers: synced.upserted, removed: synced.removed },
    'zamanlayıcılar eşitlendi',
  );

  // email_outbox.sweep `notifications` kuyruğuna yeniden ekler (yalnız üretici; tüketici worker).
  const notifications = new Queue('notifications', { connection: redis, prefix: BULLMQ_PREFIX });
  notifications.on('error', (err: unknown) => {
    logger.warn({ event: 'dependency.degraded', dependency: 'valkey', ...errFields(err) });
  });

  const metrics = new Metrics();
  const processor = createProcessor({
    queue: QUEUE,
    handlers: {
      'audit.seal': () => processAuditSeal({ db, logger, metrics }),
      'backup.verify': () =>
        processBackupVerify({
          url: env.BACKUP_STATUS_URL,
          tokenFile: env.BACKUP_STATUS_TOKEN_FILE,
          store: redis,
          logger,
          metrics,
        }),
      'email_outbox.sweep': () =>
        processEmailOutboxSweep({ db, queue: notifications, logger, metrics }),
    },
    logger,
    metrics,
  });
  const worker = new Worker(QUEUE, (job) => processor(job), {
    connection: redis,
    prefix: BULLMQ_PREFIX,
    concurrency: CONFIG_DEFAULTS['jobs.concurrency.maintenance'],
    lockDuration: CONFIG_DEFAULTS['jobs.lockDurationMs'],
    stalledInterval: CONFIG_DEFAULTS['jobs.stalledIntervalMs'],
    maxStalledCount: CONFIG_DEFAULTS['jobs.maxStalledCount'],
  });
  worker.on('error', (err: unknown) => {
    logger.warn({ event: 'dependency.degraded', dependency: 'valkey', ...errFields(err) });
  });

  let draining = false;
  const server = startHealthServer(env.WORKER_METRICS_PORT, logger, 'jobs', {
    checks: {
      pg: () => db.query('SELECT 1'),
      valkey: () => redis.ping(),
    },
    isDraining: () => draining,
    renderMetrics: () => metrics.render(),
  });

  installShutdown(logger, async () => {
    draining = true;
    const drained = await drainWorker(worker);
    if (drained === 'forced') logger.warn({ event: 'shutdown.forced', reason: 'grace_elapsed' });
    await queue.close();
    await notifications.close();
    await redis.quit();
    await db.end();
    await closeServer(server);
  });
}

const env = load('jobs');
const logger = createLogger({
  service: 'eda-jobs',
  level: env.LOG_LEVEL === 'silent' ? 'fatal' : env.LOG_LEVEL,
});
start(env, logger).catch((err: unknown) => {
  logger.fatal({ event: 'process.fatal', ...errFields(err) }, 'jobs başlatılamadı');
  process.exit(1);
});
