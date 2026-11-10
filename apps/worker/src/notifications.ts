// `notifications` kuyruğu tüketicisi (043 §11.4; 045 §6): yalnız `email.send` (P04a). `push.send`,
// `reminder.dispatch`, `retention.notify` ilgili promptlarda eklenir; kayıtlı olmayan iş kalıcı
// hatadır. Yük strict şemayla doğrulanır; hız sınırı ertelemesi deneme tüketmez (`moveToDelayed`).
import { readFileSync } from 'node:fs';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EnvOf } from '@eda/contracts/config/env';
import { BULLMQ_PREFIX, JobPayloadError, parseJobPayload } from '@eda/contracts/queues';
import { parseKekFile } from '@eda/crypto';
import { withNoTenant, withUserScope } from '@eda/db';
import { createEmailTransport } from '@eda/email/transport';
import type { EdaLogger } from '@eda/observability/logger';
import { DelayedError, type Job, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Metrics } from './metrics.ts';
import {
  type EmailRateCounter,
  type EmailSendDeps,
  processEmailSend,
} from './processors/notifications/email-send.ts';

export const NOTIFICATIONS_QUEUE = 'notifications';
export const EMAIL_RATE_KEY_PREFIX = 'eda:rl:email:';

/** `eda:rl:email:<userId>` sabit pencereli sayaç (045 §6.5 adım 3). */
export function valkeyRateCounter(redis: Redis, windowSec = 3600): EmailRateCounter {
  return {
    async hit(userId) {
      const key = `${EMAIL_RATE_KEY_PREFIX}${userId}`;
      const n = await redis.incr(key);
      if (n === 1) await redis.expire(key, windowSec);
      return n;
    },
  };
}

export interface NotificationJob {
  readonly name: string;
  readonly data: unknown;
  readonly attemptsMade: number;
  readonly opts: { readonly attempts?: number };
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
}

/** İş işleyicisi (test edilebilir; BullMQ'dan bağımsız alt küme). */
export function createNotificationsHandler(deps: EmailSendDeps) {
  return async (job: NotificationJob, token?: string) => {
    if (job.name !== 'email.send') {
      throw new UnrecoverableError(`bu kuyrukta kayıtlı olmayan iş: ${job.name}`);
    }
    let payload: { deliveryId: string };
    try {
      payload = parseJobPayload('email.send', job.data);
    } catch (err) {
      if (err instanceof JobPayloadError) throw new UnrecoverableError(err.message);
      throw err;
    }
    const attempts = job.opts.attempts ?? 1;
    const outcome = await processEmailSend(
      { deliveryId: payload.deliveryId, lastAttempt: job.attemptsMade + 1 >= attempts },
      deps,
    );
    if (outcome.status === 'deferred') {
      await job.moveToDelayed(outcome.untilMs, token);
      throw new DelayedError();
    }
    return outcome;
  };
}

export function startNotificationsWorker(
  env: EnvOf<'worker'>,
  redis: Redis,
  logger: EdaLogger,
  metrics: Metrics,
): Worker {
  // Taşıma seçimi sır okumadan önce doğrulanır: production'da smtp başlatma hatasıdır ve süreç
  // çıkış kodu 1 ile kapanır (main.ts; KK-P04a-15).
  const transport = createEmailTransport({
    edaEnv: env.EDA_ENV,
    transport: env.EMAIL_TRANSPORT,
    smtpUrl: env.SMTP_URL,
    apiUrl: env.EMAIL_API_URL,
    // Anahtar yalnız `http` taşımasında ve dosyadan okunur; değer hiçbir yere yazılmaz.
    apiKey:
      env.EMAIL_TRANSPORT === 'http'
        ? readFileSync(env.EMAIL_API_KEY_FILE, 'utf8').trim()
        : undefined,
    from: env.EMAIL_FROM,
    timeoutMs: CONFIG_DEFAULTS['notifications.emailTimeoutMs'],
  });
  const { kek } = parseKekFile(readFileSync(env.KEK_MASTER_FILE, 'utf8'));
  const appDomain = env.APP_DOMAIN ?? new URL(env.APP_URL).hostname;
  const handler = createNotificationsHandler({
    db: { withNoTenant, withUserScope },
    kek,
    transport,
    rate: valkeyRateCounter(redis),
    logger,
    metrics,
    appUrl: env.APP_URL,
    appDomain,
    companyName: null,
  });
  const worker = new Worker(
    NOTIFICATIONS_QUEUE,
    (job: Job, token?: string) => handler(job, token),
    {
      connection: redis,
      prefix: BULLMQ_PREFIX,
      concurrency: CONFIG_DEFAULTS['jobs.concurrency.notifications'],
      lockDuration: CONFIG_DEFAULTS['jobs.lockDurationMs'],
      stalledInterval: CONFIG_DEFAULTS['jobs.stalledIntervalMs'],
      maxStalledCount: CONFIG_DEFAULTS['jobs.maxStalledCount'],
    },
  );
  worker.on('closed', () => transport.close());
  return worker;
}
