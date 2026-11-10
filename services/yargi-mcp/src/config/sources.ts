// Kaynak/dayanıklılık ayarları (002 §7, 021 §5.9–§5.12): başlangıçta @eda/contracts varsayılanları;
// çalışırken api'nin valkey-cache `eda:cfg:sources` anahtarına yayımladığı etkin değerler 30 sn'de bir
// okunur (021 §6.1; ACL `%R~eda:cfg:*`). Anahtar yoksa varsayılanlar, okunamıyor veya geçersizse son
// geçerli değerler kalır. Nesne yerinde güncellenir: ağ geçidi ve araçlar her çağrıda güncel değeri görür.
import { CONFIG_DEFAULTS, type ConfigKey } from '@eda/contracts/config/defaults';
import type { SourceCode } from '@eda/contracts/enums';
import { PublishedSourcesConfig, VALKEY_CACHE_KEYS } from '@eda/contracts/mcp';
import type { EdaLogger } from '@eda/observability/logger';
import type { ValkeyClient } from '../resilience/valkey.ts';

/** 021 §6.1 / P11.5: yargi-mcp `eda:cfg:sources` anahtarını 30 sn'de bir okur. */
export const SOURCES_CONFIG_REFRESH_MS = 30_000;

const FLAT = {
  bedestenTokenIntervalMs: 'sources.bedesten.tokenIntervalMs',
  anayasaTokenIntervalMs: 'sources.anayasa.tokenIntervalMs',
  uyusmazlikTokenIntervalMs: 'sources.uyusmazlik.tokenIntervalMs',
  mevzuatTokenIntervalMs: 'sources.mevzuat.tokenIntervalMs',
  interactiveMaxWaitMs: 'sources.interactiveMaxWaitMs',
  interactiveSharePct: 'sources.interactiveSharePct',
  priorityWindowMs: 'sources.priorityWindowMs',
  singleFlightLockMs: 'sources.singleFlightLockMs',
  retryAfterDefaultSec: 'sources.retryAfterDefaultSec',
  retryAfterMaxSec: 'sources.retryAfterMaxSec',
  perSourceConcurrency: 'sources.perSourceConcurrency',
  timeoutConnectMs: 'sources.timeoutConnectMs',
  timeoutSearchMs: 'sources.timeoutSearchMs',
  /** Uyuşmazlık tam metin araması daha uzundur. */
  uyusmazlikTimeoutSearchMs: 'sources.uyusmazlik.timeoutSearchMs',
  timeoutDocMs: 'sources.timeoutDocMs',
  retries: 'sources.retries',
  maxDocChars: 'sources.maxDocChars',
  decisionSectionMaxChars: 'sources.decisionSectionMaxChars',
  docLruTtlSec: 'sources.docLruTtlSec',
  docLruMaxEntries: 'sources.docLruMaxEntries',
  searchTtlHours: 'cache.searchTtlHours',
  legislationTtlHours: 'cache.legislationTtlHours',
  degradedErrorPct: 'sources.degradedErrorPct',
} as const satisfies Record<string, ConfigKey>;

const BREAKER = {
  windowMs: 'breaker.windowMs',
  errorRatePct: 'breaker.errorRatePct',
  consecutiveFailures: 'breaker.consecutiveFailures',
  openMs: 'breaker.openMs',
  openMaxMs: 'breaker.openMaxMs',
  wafOpenMs: 'breaker.wafOpenMs',
} as const satisfies Record<string, ConfigKey>;

export type SourcesConfig = { -readonly [K in keyof typeof FLAT]: number } & {
  breaker: { -readonly [K in keyof typeof BREAKER]: number };
};

type NumericValues = Partial<Record<ConfigKey, number>>;

function num(values: NumericValues, key: ConfigKey): number {
  const v = values[key] ?? CONFIG_DEFAULTS[key];
  if (typeof v !== 'number') throw new Error(`sayısal yapılandırma bekleniyor: ${key}`);
  return v;
}

function build(values: NumericValues): SourcesConfig {
  const flat = Object.fromEntries(
    Object.entries(FLAT).map(([field, key]) => [field, num(values, key)]),
  ) as { [K in keyof typeof FLAT]: number };
  const breaker = Object.fromEntries(
    Object.entries(BREAKER).map(([field, key]) => [field, num(values, key)]),
  ) as SourcesConfig['breaker'];
  return { ...flat, breaker };
}

export function defaultSourcesConfig(): SourcesConfig {
  return build({});
}

/** Yayımlanan değerleri `cfg` nesnesine yerinde uygular (bilinmeyen anahtarlar yok sayılır). */
export function applyPublishedValues(cfg: SourcesConfig, values: NumericValues): void {
  const next = build(values);
  Object.assign(cfg.breaker, next.breaker);
  const { breaker: _ignored, ...flat } = next;
  Object.assign(cfg, flat);
}

export type SourcesConfigReader = { refresh: () => Promise<void>; stop: () => void };

/**
 * `eda:cfg:sources` okuyucusu. `enabled` kümesi yerinde güncellenir: yayımlanan `sources_enabled`
 * yalnız `YARGI_SOURCES_ENABLED` (envEnabled) kümesini daraltır, genişletmez.
 */
export function startSourcesConfigReader(opts: {
  client: Pick<ValkeyClient, 'get'>;
  cfg: SourcesConfig;
  enabled: Set<SourceCode>;
  envEnabled: readonly SourceCode[];
  logger: EdaLogger;
  intervalMs?: number;
}): SourcesConfigReader {
  let lastPublishedAt: string | null = null;
  const refresh = async (): Promise<void> => {
    let raw: string | null;
    try {
      raw = await opts.client.get(VALKEY_CACHE_KEYS.sourcesConfig);
    } catch {
      opts.logger.warn({ event: 'dependency.degraded', scope: 'valkey_cache', op: 'config_read' });
      return;
    }
    let values: NumericValues = {};
    let allow: readonly SourceCode[] | null = null;
    let publishedAt: string | null = null;
    if (raw !== null) {
      let parsed: ReturnType<typeof PublishedSourcesConfig.safeParse>;
      try {
        parsed = PublishedSourcesConfig.safeParse(JSON.parse(raw));
      } catch {
        parsed = PublishedSourcesConfig.safeParse(null);
      }
      if (!parsed.success) {
        opts.logger.warn({ event: 'config.setting_invalid', key: VALKEY_CACHE_KEYS.sourcesConfig });
        return;
      }
      values = parsed.data.values as NumericValues;
      allow = parsed.data.sources_enabled;
      publishedAt = parsed.data.published_at;
    }
    applyPublishedValues(opts.cfg, values);
    opts.enabled.clear();
    for (const s of opts.envEnabled) if (allow === null || allow.includes(s)) opts.enabled.add(s);
    if (publishedAt !== lastPublishedAt) {
      lastPublishedAt = publishedAt;
      opts.logger.info({
        event: 'config.loaded',
        scope: 'sources',
        published: publishedAt !== null,
        enabled_sources: [...opts.enabled],
      });
    }
  };
  const timer = setInterval(() => void refresh(), opts.intervalMs ?? SOURCES_CONFIG_REFRESH_MS);
  timer.unref();
  return { refresh, stop: () => clearInterval(timer) };
}
