// Kuyruk ve iş kayıt defteri (043 §2.4, §3, §4, §5.3, §7.1, §9; 002 §17). Tek kaynak: kuyruk adları,
// iş -> kuyruk eşlemesi, yük şeması, öncelik, deneme sayısı, zaman aşımı sınıfı ve Job Scheduler kaydı.
// Kayıt defteri 002 §17 listesinin üst kümesi olamaz (KK-P03c-17 testi). Saf modül: BullMQ bilmez;
// seçenekler düz nesne olarak üretilir.
import type { z } from 'zod';
import { CONFIG_DEFAULTS } from './config/defaults.ts';
import { JOBS_ONLY_QUEUE, QUEUE_NAMES, type QueueName } from './config/env.ts';
import { SourceStatusCanaryPayload } from './jobs/corpus.ts';
import { EmailOutboxSweepPayload, EmailSendJob } from './jobs/email.ts';
import { FileExtractJob, FileScanJob } from './jobs/files.ts';
import { AuditSealPayload, BackupVerifyPayload } from './jobs/maintenance.ts';

export type { QueueName };

/** 002 §17 kuyrukları (env şemasıyla aynı dizi). */
export const QUEUES = QUEUE_NAMES;

/** BullMQ anahtar öneki (002 §17, §18). */
export const BULLMQ_PREFIX = 'eda:bull';

/** Zamanlayıcı saat dilimi (043 §2.2, §9; süreçler TZ=UTC çalışır). */
export const SCHEDULER_TZ = 'Europe/Istanbul';

/** Kuyruğu tüketen süreç sınıfı (043 §1 madde 4, KK-002-12). */
export const QUEUE_CONSUMERS = ['worker', 'jobs'] as const;
export type QueueConsumer = (typeof QUEUE_CONSUMERS)[number];

export function queueConsumer(queue: QueueName): QueueConsumer {
  return queue === JOBS_ONLY_QUEUE ? 'jobs' : 'worker';
}

/** Zaman aşımı sınıfları (043 §5.3; süreler `jobs.timeoutSec.<sınıf>`). */
export const TIMEOUT_CLASSES = [
  'light',
  'standard',
  'heavy',
  'ocr',
  'corpus',
  'maintenance',
] as const;
export type TimeoutClass = (typeof TIMEOUT_CLASSES)[number];

export function timeoutMs(timeoutClass: TimeoutClass): number {
  return CONFIG_DEFAULTS[`jobs.timeoutSec.${timeoutClass}`] * 1000;
}

export interface JobSchedulerDef {
  /** 043 §9 `schedulerId`. */
  readonly id: string;
  /** Cron kalıbı (adım biçimi kullanılmaz, ofsetler açık yazılır; 043 §9). */
  readonly pattern: string;
  readonly tz: typeof SCHEDULER_TZ;
}

export interface JobDef {
  readonly queue: QueueName;
  /** BullMQ önceliği (043 §4; küçük sayı önce). */
  readonly priority: number;
  readonly attempts: number;
  readonly timeoutClass: TimeoutClass;
  /** Strict Zod yük şeması (zarf + kimlikler). */
  readonly payload: z.ZodType;
  readonly scheduler?: JobSchedulerDef;
}

export const JOBS = {
  'audit.seal': {
    queue: 'maintenance',
    priority: 2,
    attempts: CONFIG_DEFAULTS['jobs.attempts'],
    timeoutClass: 'maintenance',
    payload: AuditSealPayload,
    scheduler: { id: 'maintenance.audit_seal', pattern: '* * * * *', tz: SCHEDULER_TZ },
  },
  // 043 §9, §10.11: yedek durum ucunu (backup :8433, `data` ağı) okur, özeti Valkey'e yazar; DB yetkisi yok.
  'backup.verify': {
    queue: 'maintenance',
    priority: 10,
    attempts: CONFIG_DEFAULTS['jobs.attempts'],
    timeoutClass: 'maintenance',
    payload: BackupVerifyPayload,
    scheduler: { id: 'maintenance.backup_verify', pattern: '50 3 * * *', tz: SCHEDULER_TZ },
  },
  // 045 §6.3: öncelik ve deneme sayısı sınıfa göre kuyruğa almada ezilir (`emailJobOptions`); burada
  // `service` sınıfının değerleri varsayılandır (043 §4 öncelik 5, §7.1 deneme).
  'email.send': {
    queue: 'notifications',
    priority: 5,
    attempts: CONFIG_DEFAULTS['jobs.attempts'],
    timeoutClass: 'light',
    payload: EmailSendJob,
  },
  'email_outbox.sweep': {
    queue: 'maintenance',
    priority: 1,
    attempts: CONFIG_DEFAULTS['jobs.attempts'],
    timeoutClass: 'maintenance',
    payload: EmailOutboxSweepPayload,
    scheduler: { id: 'maintenance.email_outbox_sweep', pattern: '* * * * *', tz: SCHEDULER_TZ },
  },
  // 043 §3.2: `files-interactive` öncelik 1 (toplu yüklemede `files-batch` öncelik 10; üretici seçer).
  'file.scan': {
    queue: 'files-interactive',
    priority: 1,
    attempts: CONFIG_DEFAULTS['jobs.attempts'],
    timeoutClass: 'standard',
    payload: FileScanJob,
  },
  // 021 §7.3, 043 §9 (`corpus.source_status_canary`, 05:00 TSİ, öncelik 5). Deneme 1: canary günde
  // kaynak başına en çok 2 istek atar (021 §7.3); yeniden deneme bu sınırı aşardı. Yoklama hataları işi
  // düşürmez, sonuç olarak kaydedilir; yalnız DB yazımı başarısız olursa iş başarısız olur.
  'source_status.canary': {
    queue: 'corpus',
    priority: 5,
    attempts: 1,
    timeoutClass: 'corpus',
    payload: SourceStatusCanaryPayload,
    scheduler: { id: 'corpus.source_status_canary', pattern: '0 5 * * *', tz: SCHEDULER_TZ },
  },
  // 033 §7.2-§7.3: temiz taramadan sonra; sohbet eki her zaman `files-interactive`.
  'file.extract': {
    queue: 'files-interactive',
    priority: 1,
    attempts: CONFIG_DEFAULTS['jobs.attempts'],
    timeoutClass: 'heavy',
    payload: FileExtractJob,
  },
} as const satisfies Record<string, JobDef>;

export type JobName = keyof typeof JOBS;
export type JobPayload<N extends JobName> = z.infer<(typeof JOBS)[N]['payload']>;

// Object.keys anahtar tipini daraltmaz; anahtarlar tanım gereği JobName'dir.
export const JOB_NAMES = Object.keys(JOBS) as readonly JobName[];

export function isJobName(name: string): name is JobName {
  return Object.hasOwn(JOBS, name);
}

/** Kuyruğun kayıtlı işleri. */
export function jobsOfQueue(queue: QueueName): readonly JobName[] {
  return JOB_NAMES.filter((name) => JOBS[name].queue === queue);
}

/** Zamanlayıcısı olan kayıtlar (043 §9). */
export function schedulersOfQueue(
  queue: QueueName,
): readonly { readonly name: JobName; readonly scheduler: JobSchedulerDef }[] {
  return JOB_NAMES.flatMap((name) => {
    const def: JobDef = JOBS[name];
    return def.queue === queue && def.scheduler !== undefined
      ? [{ name, scheduler: def.scheduler }]
      : [];
  });
}

export interface JobDefaults {
  readonly priority: number;
  readonly attempts: number;
  readonly backoff: {
    readonly type: 'exponential';
    readonly delay: number;
    readonly jitter: number;
  };
  readonly removeOnComplete: { readonly age: number; readonly count: number };
  readonly removeOnFail: { readonly age: number };
}

/**
 * İş başına varsayılan BullMQ seçenekleri (043 §7.1); düz nesne. 043 §7.4 dakikalık bakım işi saklama
 * istisnası (3600 sn / 200) 002 §7'de anahtar olmadığından uygulanmaz; §7.1 varsayılanı geçerlidir
 *.
 */
export function jobDefaults(name: JobName): JobDefaults {
  const def = JOBS[name];
  return {
    priority: def.priority,
    attempts: def.attempts,
    backoff: {
      type: 'exponential',
      delay: CONFIG_DEFAULTS['jobs.backoffBaseMs'],
      jitter: CONFIG_DEFAULTS['jobs.backoffJitter'],
    },
    removeOnComplete: {
      age: CONFIG_DEFAULTS['jobs.removeOnCompleteAgeSec'],
      count: CONFIG_DEFAULTS['jobs.removeOnCompleteCount'],
    },
    removeOnFail: { age: CONFIG_DEFAULTS['jobs.removeOnFailAgeSec'] },
  };
}

export class JobPayloadError extends Error {
  override name = 'JobPayloadError';
}

/** Yükün JSON bayt boyutu (043 §3.1 `queue.maxPayloadBytes`). */
export function payloadBytes(data: unknown): number {
  return new TextEncoder().encode(JSON.stringify(data) ?? '').byteLength;
}

/**
 * Yükü kayıt defteri şemasıyla doğrular ve boyutunu denetler (KK-043-2). Hata mesajı yalnız iş adını
 * ve nedeni içerir; yük değeri yazılmaz.
 */
export function parseJobPayload<N extends JobName>(name: N, data: unknown): JobPayload<N> {
  const result = JOBS[name].payload.safeParse(data);
  if (!result.success) throw new JobPayloadError(`iş yükü şemaya uymuyor: ${name}`);
  if (payloadBytes(result.data) > CONFIG_DEFAULTS['queue.maxPayloadBytes']) {
    throw new JobPayloadError(`iş yükü boyut sınırını aşıyor: ${name}`);
  }
  return result.data as JobPayload<N>;
}
