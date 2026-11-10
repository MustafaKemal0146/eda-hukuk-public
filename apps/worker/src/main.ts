// worker girişi (dist/main.js): WORKER_QUEUES işleyicileri. maintenance burada YASAKTIR (KK-002-12);
// şema bunu açılışta reddeder, `assertConsumerQueues` ikinci savunmadır. Bakım kodu ve eda_jobs havuzu bu
// girişten erişilemez (dependency-cruiser `worker-no-maintenance`). P04a: `notifications` kuyruğu
// (`email.send`); `corpus` kuyruğunda `source_status.canary` (021 §7.3); diğer kuyruk işleyicileri
// ilgili promptlarda eklenir.
import { closeDefaultPool } from '@eda/db';
import { createLogger } from '@eda/observability/logger';
import type { Worker } from 'bullmq';
import { load } from './config/load.ts';
import { assertConsumerQueues } from './config/queues.ts';
import { CORPUS_QUEUE, startCorpusWorker } from './corpus.ts';
import { FILE_QUEUES, startFilesWorkers } from './files.ts';
import { closeServer, startHealthServer } from './health/server.ts';
import { Metrics } from './metrics.ts';
import { NOTIFICATIONS_QUEUE, startNotificationsWorker } from './notifications.ts';
import { installShutdown } from './shutdown.ts';
import { assertNoEviction, createValkey } from './valkey.ts';

const env = load('worker');
const logger = createLogger({
  service: 'eda-worker',
  level: env.LOG_LEVEL === 'silent' ? 'fatal' : env.LOG_LEVEL,
});

async function start(): Promise<void> {
  assertConsumerQueues('worker', env.WORKER_QUEUES);
  const metrics = new Metrics();
  const workers: Worker[] = [];
  const redis = createValkey(env, 'eda-worker');
  redis.on('error', (err: unknown) => {
    logger.warn({
      event: 'dependency.degraded',
      dependency: 'valkey',
      err: err instanceof Error ? err.name : 'unknown',
    });
  });
  await redis.connect();
  await assertNoEviction(redis);
  if (env.WORKER_QUEUES.includes(NOTIFICATIONS_QUEUE)) {
    workers.push(startNotificationsWorker(env, redis, logger, metrics));
  }
  const fileQueues = FILE_QUEUES.filter((q) => env.WORKER_QUEUES.includes(q));
  if (fileQueues.length > 0) {
    workers.push(...startFilesWorkers(env, fileQueues, redis, logger, metrics));
  }
  const closers: (() => Promise<void>)[] = [];
  if (env.WORKER_QUEUES.includes(CORPUS_QUEUE)) {
    const corpus = await startCorpusWorker(env, redis, logger, metrics);
    closers.push(corpus.close);
  }
  let draining = false;
  const server = startHealthServer(env.WORKER_METRICS_PORT, logger, 'worker', {
    checks: { valkey: () => redis.ping() },
    isDraining: () => draining,
    renderMetrics: () => metrics.render(),
  });
  installShutdown(logger, async () => {
    draining = true;
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(closers.map((c) => c()));
    await redis.quit();
    await closeDefaultPool();
    await closeServer(server);
  });
}

start().catch((err: unknown) => {
  logger.fatal(
    { event: 'process.fatal', err: err instanceof Error ? err.name : 'unknown' },
    'worker başlatılamadı',
  );
  process.exit(1);
});
