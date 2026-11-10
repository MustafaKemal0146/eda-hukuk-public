// `corpus` kuyruğu tüketicisi (043 §2.1, §9; 021 §7.3): şimdilik yalnız `source_status.canary`. Kuyruğu
// tüketen süreç kendi zamanlayıcılarını açılışta eşitler (`corpus.source_status_canary`, 05:00 TSİ).
// yargi-mcp çağrıları `org: "sys"` ve `ingest` önceliğiyle yapılır (021 §5.3, §7.3); çıkış yalnız
// yargi-mcp'ye (iç ağ `mcp`), yeni dış alan adı yoktur. Uyarı alıcısı destek adresidir
// (`destek@${APP_DOMAIN}`; 045 §8.3), adres koda gömülmez.
import { readFileSync } from 'node:fs';
import {
  createYargiMcpClient,
  getLegislationLive,
  searchDecisionsLive,
  searchLegislationLive,
  type YargiMcpClient,
} from '@eda/ai/mcp';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { EnvOf } from '@eda/contracts/config/env';
import type { SourceCanaryProbe } from '@eda/contracts/enums';
import type { McpPriority } from '@eda/contracts/mcp';
import {
  BULLMQ_PREFIX,
  JOBS,
  JobPayloadError,
  parseJobPayload,
  timeoutMs,
} from '@eda/contracts/queues';
import { withNoTenant } from '@eda/db';
import {
  renderSourceCanaryAlert,
  SOURCE_CANARY_ALERT_VERSION,
  supportAddress,
} from '@eda/email/ops-alert';
import { createEmailTransport, type EmailTransport } from '@eda/email/transport';
import type { EdaLogger } from '@eda/observability/logger';
import { type Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Metrics } from './metrics.ts';
import {
  type CanaryDeps,
  dbCanaryStore,
  type ProbeCall,
  type ProbeResult,
  runSourceCanary,
} from './processors/corpus/source-status-canary.ts';
import { syncSchedulers } from './schedulers/index.ts';

export const CORPUS_QUEUE = 'corpus';
/** yargi-mcp servis JWT `aud` değeri (api istemcisiyle aynı; 021 §5.3). */
const MCP_AUDIENCE = 'yargi-mcp';
const PRIORITY: McpPriority = 'ingest';

type Settled<T> = { ok: true; value: T } | { ok: false; error: { reason: string | null } };

function settle<T>(r: Settled<T>, count: (v: T) => number, stale: (v: T) => boolean): ProbeResult {
  return r.ok
    ? { ok: true, count: count(r.value), stale: stale(r.value) }
    : { ok: false, reason: r.error.reason };
}

/**
 * Sabit, genel, kişisel veri içermeyen canary sorguları (021 §7.3). Sorgu metni günlüğe ve DB'ye yazılmaz.
 * Sonuç istenen en küçük sayfadır (1 kayıt); mevzuat maddesi İş Kanunu m. 1'dir (yürürlükte, kısa).
 */
export function canaryProbes(client: YargiMcpClient): Record<SourceCanaryProbe, ProbeCall> {
  const opts = (signal: AbortSignal, timeoutMs?: number) => ({
    priority: PRIORITY,
    signal,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  const decisions = (
    source: 'bedesten' | 'anayasa' | 'uyusmazlik',
    query: string,
    courtType: 'yargitay' | 'aym_bireysel' | 'uyusmazlik',
    timeoutMs?: number,
  ): ProbeCall => {
    return async (signal) =>
      settle(
        await searchDecisionsLive(
          client,
          {
            source,
            query,
            court_types: [courtType],
            chamber: null,
            date_from: null,
            date_to: null,
            esas_no: null,
            karar_no: null,
            page: 1,
            page_size: 1,
          },
          opts(signal, timeoutMs),
        ),
        (v) => v.results.length,
        (v) => v.status === 'stale',
      );
  };
  return {
    uyap_search: decisions('bedesten', 'kıdem tazminatı', 'yargitay'),
    anayasa_search: decisions('anayasa', 'ifade özgürlüğü', 'aym_bireysel'),
    uyusmazlik_search: decisions(
      'uyusmazlik',
      'görev uyuşmazlığı',
      'uyusmazlik',
      CONFIG_DEFAULTS['sources.mcpSlowSearchTimeoutMs'],
    ),
    mevzuat_search: async (signal) =>
      settle(
        await searchLegislationLive(
          client,
          { query: 'iş sözleşmesi', law_no: null, page: 1, page_size: 1 },
          opts(signal),
        ),
        (v) => v.results.length,
        () => false,
      ),
    mevzuat_article: async (signal) =>
      settle(
        await getLegislationLive(
          client,
          { law_no: '4857', law_type: null, article_no: '1', article_to: null },
          opts(signal),
        ),
        (v) => v.articles.length,
        () => false,
      ),
  };
}

/** Uyarı gönderici: render + doğrudan taşıma (alıcı kullanıcı değil, destek adresi). */
export function alertSender(
  transport: EmailTransport,
  appDomain: string,
  now: () => Date = () => new Date(),
): CanaryDeps['sendAlert'] {
  return async (input) => {
    const msg = await renderSourceCanaryAlert(input, null);
    const ref = `source-canary-${input.kind}-${now().getTime()}`;
    await transport.send({
      to: supportAddress(appDomain),
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: {
        'Reply-To': supportAddress(appDomain),
        'Message-ID': `<${ref}@${appDomain}>`,
        'X-Entity-Ref-ID': `${ref}-${SOURCE_CANARY_ALERT_VERSION}`,
        'Auto-Submitted': 'auto-generated',
      },
    });
  };
}

export function emailTransportFromEnv(env: EnvOf<'worker'>): EmailTransport {
  return createEmailTransport({
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
}

export class CorpusJobTimeoutError extends Error {
  override name = 'CorpusJobTimeoutError';
}

/** BullMQ `Job`'un kullanılan alt kümesi. */
export interface CorpusJob {
  readonly name: string;
  readonly data: unknown;
}

/**
 * İş dağıtıcısı (test edilebilir; BullMQ'dan bağımsız). Kayıtlı olmayan iş ve geçersiz yük kalıcı hatadır;
 * işleyici `jobs.timeoutSec.corpus` ile zaman kutusuna alınır (aşımda yoklamalar iptal sinyali alır).
 * Günlükte yük ve sonuç yoktur. Not: `jobs/processor.ts` bakım altyapısıdır ve worker girişinden
 * erişilemez (dependency-cruiser `worker-no-maintenance`); bu yüzden dağıtıcı buradadır.
 */
export function createCorpusHandler(deps: () => Omit<CanaryDeps, 'signal'>, overrideMs?: number) {
  return async (job: CorpusJob): Promise<unknown> => {
    if (job.name !== 'source_status.canary' || JOBS[job.name].queue !== CORPUS_QUEUE) {
      throw new UnrecoverableError(`bu kuyrukta kayıtlı olmayan iş: ${job.name}`);
    }
    try {
      parseJobPayload('source_status.canary', job.data);
    } catch (err) {
      if (err instanceof JobPayloadError) throw new UnrecoverableError(err.message);
      throw err;
    }
    const ms = overrideMs ?? timeoutMs(JOBS['source_status.canary'].timeoutClass);
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new CorpusJobTimeoutError(`iş zaman aşımına uğradı: ${job.name}`));
        controller.abort();
      }, ms);
    });
    try {
      return await Promise.race([
        runSourceCanary({ ...deps(), signal: controller.signal }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function startCorpusWorker(
  env: EnvOf<'worker'>,
  redis: Redis,
  logger: EdaLogger,
  metrics: Metrics,
): Promise<{ worker: Worker; close: () => Promise<void> }> {
  const queue = new Queue(CORPUS_QUEUE, { connection: redis, prefix: BULLMQ_PREFIX });
  queue.on('error', (err: unknown) => {
    logger.warn({
      event: 'dependency.degraded',
      dependency: 'valkey',
      err: err instanceof Error ? err.name : 'unknown',
    });
  });
  const synced = await syncSchedulers(queue, CORPUS_QUEUE);
  logger.info(
    {
      event: 'config.loaded',
      queue: CORPUS_QUEUE,
      schedulers: synced.upserted,
      removed: synced.removed,
    },
    'zamanlayıcılar eşitlendi',
  );
  const transport = emailTransportFromEnv(env);
  const client = await createYargiMcpClient({
    url: env.YARGI_MCP_URL,
    audience: MCP_AUDIENCE,
    privateKeyFile: env.INTERNAL_JWT_PRIVATE_KEY_FILE,
  });
  const appDomain = env.APP_DOMAIN ?? new URL(env.APP_URL).hostname;
  const handler = createCorpusHandler(() => ({
    probes: canaryProbes(client),
    store: dbCanaryStore({ withNoTenant }),
    sendAlert: alertSender(transport, appDomain),
    logger,
    metrics,
  }));
  const worker = new Worker(CORPUS_QUEUE, (job: Job) => handler(job), {
    connection: redis,
    prefix: BULLMQ_PREFIX,
    concurrency: CONFIG_DEFAULTS['jobs.concurrency.corpus'],
    lockDuration: CONFIG_DEFAULTS['jobs.lockDurationMs'],
    stalledInterval: CONFIG_DEFAULTS['jobs.stalledIntervalMs'],
    maxStalledCount: CONFIG_DEFAULTS['jobs.maxStalledCount'],
  });
  return {
    worker,
    close: async () => {
      await worker.close();
      await queue.close();
      transport.close();
      await client.close();
    },
  };
}
