// valkey-cache anahtarları (002 §18; 021 §5.9–§5.11, §6.1) ve api'nin yayımladığı kaynak yapılandırması.
// Anahtar ve değerlerde sorgu metni / içerik bulunmaz: kimlikler SHA-256 hex, kaynak kodu veya sınıf adıdır.
import { z } from 'zod';
import { CONFIG_DEFAULTS, type ConfigKey } from '../config/defaults.ts';
import { SourceCode } from '../tools/common.ts';
import type { McpPriority } from './common.ts';

const SHA256_HEX = /^[0-9a-f]{64}$/;

function sha(id: string): string {
  if (!SHA256_HEX.test(id)) throw new Error('valkey anahtarı: SHA-256 hex bekleniyor');
  return id;
}

/** valkey-cache anahtar şablonları (002 §18). */
export const VALKEY_CACHE_KEYS = {
  /** Arama / mevzuat sonuç önbelleği: `eda:src:<source>:<sha256>`. */
  sourceResult: (source: string, id: string): string => `eda:src:${source}:${sha(id)}`,
  /** Tek uçuş kilidi: `eda:sf:<sha256>`. */
  singleFlight: (id: string): string => `eda:sf:${sha(id)}`,
  /** Devre kesici durumu: `eda:brk:<source>`. */
  breaker: (source: string): string => `eda:brk:${source}`,
  /** Kaynak token kovası: `eda:tb:source:<kova>`. */
  sourceBucket: (bucket: string): string => `eda:tb:source:${bucket}`,
  /** Öncelik sınıfı sayaçları: `eda:lq:<sınıf>` (hash `g`, `d`, `w`, `ws`). */
  priorityCounters: (cls: McpPriority): string => `eda:lq:${cls}`,
  /** api yayımlar, yargi-mcp okur (021 §6.1 config-publisher). */
  sourcesConfig: 'eda:cfg:sources',
} as const;

/** `eda:cfg:sources` içinde yayımlanabilen yapılandırma önekleri (021 §6.1). */
export const PUBLISHED_SOURCE_CONFIG_PREFIXES = ['sources.', 'breaker.', 'cache.'] as const;

const publishableKey = z
  .string()
  .refine(
    (k): k is ConfigKey =>
      Object.hasOwn(CONFIG_DEFAULTS, k) &&
      PUBLISHED_SOURCE_CONFIG_PREFIXES.some((p) => k.startsWith(p)) &&
      typeof CONFIG_DEFAULTS[k as ConfigKey] === 'number',
    { message: 'yayımlanamayan yapılandırma anahtarı' },
  );

/**
 * `eda:cfg:sources` değeri: api açılışta ve `system_setting.changed` olayında etkin
 * `sources.*`, `breaker.*`, `cache.*` sayısal değerlerini ve etkin canlı kaynak listesini yazar.
 * yargi-mcp `sources_enabled` ile yalnız kendi `YARGI_SOURCES_ENABLED` kümesini daraltır, genişletmez.
 */
export const PublishedSourcesConfig = z
  .object({
    v: z.literal(1),
    published_at: z.iso.datetime(),
    sources_enabled: z.array(SourceCode).nullable(),
    values: z.record(publishableKey, z.number().finite().nonnegative()),
  })
  .strict();
export type PublishedSourcesConfigValue = z.infer<typeof PublishedSourcesConfig>;
