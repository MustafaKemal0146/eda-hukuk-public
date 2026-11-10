// Yönetim paneli "Sistem" modülü sözleşmeleri (`GET /api/v1/admin/system`). Yalnız sayaç, boyut ve
// durum taşır: anahtar adı/içeriği, iş yükü, sorgu metni, adres veya hata metni YOKTUR. Her bölüm
// bağımsızdır; erişilemeyen bölüm `available: false` ile gelir (diğerleri etkilenmez).
import { z } from 'zod';
import { QUEUE_NAMES } from '../config/env.ts';
import { SOURCE_CANARY_OUTCOMES, SOURCE_CANARY_PROBES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });
const Count = z.number().int().nonnegative();

/** `/ready` yoklama adlarıyla aynı (apps/api/src/main.ts). */
export const SYSTEM_SERVICE_KEYS = [
  'postgres',
  'valkey',
  'valkeyCache',
  'objstore',
  'embedQuery',
  'yargiMcp',
] as const;
export type SystemServiceKey = (typeof SYSTEM_SERVICE_KEYS)[number];

export const SystemServiceDto = z.strictObject({
  key: z.enum(SYSTEM_SERVICE_KEYS),
  /** `ok` yeşil; `degraded` sarı (yumuşak bağımlılık yok); `fail` kırmızı (sert bağımlılık yok). */
  state: z.enum(['ok', 'degraded', 'fail']),
  hard: z.boolean(),
  latencyMs: Count,
  checkedAt: IsoDateTime,
});

export const SystemCacheDto = z.strictObject({
  available: z.boolean(),
  hits: Count,
  misses: Count,
  /** 0..1; hiç arama yoksa `null`. */
  hitRate: z.number().min(0).max(1).nullable(),
  usedMemoryBytes: Count,
  /** 0 = sınırsız. */
  maxMemoryBytes: Count,
  keys: Count,
  evictedKeys: Count,
  expiredKeys: Count,
  uptimeSeconds: Count,
});

export const SystemQueueDto = z.strictObject({
  name: z.enum(QUEUE_NAMES),
  waiting: Count,
  active: Count,
  failed: Count,
  delayed: Count,
});

export const SystemSchemaSizeDto = z.strictObject({
  schema: z.string(),
  tables: Count,
  totalBytes: Count,
  indexBytes: Count,
  estimatedRows: Count,
});

export const SystemTableSizeDto = z.strictObject({
  table: z.string(),
  totalBytes: Count,
  indexBytes: Count,
  estimatedRows: Count,
});

export const SystemDatabaseDto = z.strictObject({
  available: z.boolean(),
  connections: z.strictObject({
    total: Count,
    max: Count,
  }),
  databaseBytes: Count,
  schemas: z.array(SystemSchemaSizeDto),
  topTables: z.array(SystemTableSizeDto),
});

/**
 * Yedek durumu (yalnız okuma; kaynak yedek betiğinin içeriksiz durum kaydı). Kaynak yoksa/ulaşılamıyorsa
 * `available: false` ve neden kodu gelir; zaman alanları `null` kalır. Yol, etiket, boyut ve hata metni yoktur.
 */
export const SystemBackupDto = z.strictObject({
  available: z.boolean(),
  unavailableReason: z.enum(['no_source', 'unreachable', 'invalid']).nullable(),
  generatedAt: IsoDateTime.nullable(),
  /** Betiğin genel kararı: `ok`, `degraded` (ör. uzak kopya kapalı) veya `error`. */
  overall: z.enum(['ok', 'degraded', 'error']).nullable(),
  lastFullAt: IsoDateTime.nullable(),
  lastRunOk: z.boolean().nullable(),
  lastRunAt: IsoDateTime.nullable(),
  walLastArchivedAt: IsoDateTime.nullable(),
  /** Son WAL arşivinden bu yana geçen saniye; kayıtta zaman yoksa `null`. */
  walLagSeconds: Count.nullable(),
  offsiteWalSyncAt: IsoDateTime.nullable(),
  restoreDrillAt: IsoDateTime.nullable(),
  restoreDrillOk: z.boolean().nullable(),
});

/**
 * Kaynak kanaryası yoklaması (021 §7.3): son kontrol, son sonuç, art arda başarısızlık ve pencere içi
 * başarı oranı. Sorgu metni, yanıt ve hata metni YOKTUR. `state`: `ok` yeşil (son sonuç başarılı),
 * `failing` kırmızı (son sonuç başarısız), `unknown` henüz kontrol yok.
 */
export const SystemSourceProbeDto = z.strictObject({
  probe: z.enum(SOURCE_CANARY_PROBES),
  state: z.enum(['ok', 'failing', 'unknown']),
  lastCheckedAt: IsoDateTime.nullable(),
  lastOutcome: z.enum(SOURCE_CANARY_OUTCOMES).nullable(),
  lastDurationMs: Count.nullable(),
  consecutiveFailures: Count,
  /** `consecutiveFailures >= failThreshold` (e-posta uyarısının eşiği). */
  degraded: z.boolean(),
  windowRuns: Count,
  windowOk: Count,
  /** 0..1; pencerede çalıştırma yoksa `null`. */
  successRate: z.number().min(0).max(1).nullable(),
});

export const SystemSourceCanaryDto = z.strictObject({
  available: z.boolean(),
  windowDays: Count,
  failThreshold: Count,
  items: z.array(SystemSourceProbeDto),
});

export const AdminSystemDto = z.strictObject({
  generatedAt: IsoDateTime,
  /** Salt okur; değiştirme ucu bu modülde yoktur. */
  maintenanceMode: z.boolean(),
  services: z.array(SystemServiceDto),
  cache: SystemCacheDto,
  queues: z.strictObject({ available: z.boolean(), items: z.array(SystemQueueDto) }),
  database: SystemDatabaseDto,
  backup: SystemBackupDto,
  sourceCanary: SystemSourceCanaryDto,
});
export type AdminSystemDtoValue = z.infer<typeof AdminSystemDto>;
