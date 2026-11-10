// Platform ayarı sağlayıcısı: sohbet yolunun "ortak anahtar" kararını ve platform geneli günlük
// sınırlarını TEK yerden, kısa TTL'li önbellekle (varsayılan 30 sn) verir. Anahtar çözümleme sırası:
// yönetimden girilen DB anahtarı (KEK türevli anahtarla şifreli) > sunucu sır dosyası > yok.
// Düşüş YALNIZ `envGate` (PLATFORM_AI_KEY_FALLBACK + izinli ortam; SERT kapı) VE panel anahtarı
// (`fallback_enabled`; YUMUŞAK) birlikte açıkken geçerlidir; env kapalıysa DB'ye hiç gidilmez.
// Düz metin anahtar yalnız bellekte (önbellek ömrü boyunca) tutulur; loga, hataya ve yanıta yazılmaz.
import { decryptField, wipe } from '@eda/crypto';
import { derivePlatformKey, platformKeyContext } from './crypto.ts';

/** `app.platform_settings_runtime()` satırı (şifreli değer dahil; yalnız bu modül çözer). */
export interface PlatformSettingsRow {
  readonly keyEnc: Buffer | null;
  readonly keyVersion: number | null;
  readonly keyLabel: string | null;
  readonly keyLast4: string | null;
  readonly fallbackEnabled: boolean;
  readonly userTurnsPerDay: number | null;
  readonly userTokensPerDay: number | null;
  readonly orgDailyCapMicroUsd: number | null;
  readonly platformDailyCapMicroUsd: number | null;
}

/** Panelden ayarlanan platform geneli sınırlar; `null` = yapılandırma zinciri (`platformKey.*`, `costGuard.*`). */
export interface PlatformLimits {
  readonly userTurnsPerDay: number | null;
  readonly userTokensPerDay: number | null;
  readonly orgDailyCapMicroUsd: number | null;
  /** Platform geneli (tüm kullanıcılar) günlük harcama tavanı, mikro-USD. */
  readonly platformDailyCapMicroUsd: number | null;
}

export const NO_PLATFORM_LIMITS: PlatformLimits = {
  userTurnsPerDay: null,
  userTokensPerDay: null,
  orgDailyCapMicroUsd: null,
  platformDailyCapMicroUsd: null,
};

export type PlatformKeySource = 'panel' | 'server_secret';

export interface PlatformSnapshot {
  /** Sert kapı (env) VE yumuşak anahtar (panel) açık mı. Kapalıysa `apiKey` her zaman `null`. */
  readonly enabled: boolean;
  /** Kullanılacak düz metin anahtar (yalnız `enabled` iken); yoksa `null`. */
  readonly apiKey: string | null;
  /** Kullanıcıya gösterilecek ad (yalnız panel anahtarında); sır dosyasında `null`. */
  readonly label: string | null;
  readonly source: PlatformKeySource | null;
  readonly limits: PlatformLimits;
}

export interface PlatformSettingsProvider {
  get(): Promise<PlatformSnapshot>;
  /** Önbelleği düşürür (aynı süreçteki yönetim yazmasından sonra; diğer süreçler TTL ile yetişir). */
  invalidate(): void;
}

export interface PlatformSettingsDeps {
  /** Sert kapı: `PLATFORM_AI_KEY_FALLBACK=true` ve ortam development/test/beta-synthetic. */
  readonly envGate: boolean;
  readonly load: () => Promise<PlatformSettingsRow>;
  readonly kek: Buffer;
  /** Sunucu sır dosyası (`anthropic_api_key`); yoksa `null`. */
  readonly readFileKey: () => string | null;
  readonly now: () => number;
  readonly ttlMs?: number;
  /** İçeriksiz olay adı (log): `ai.platform_settings_load_failed`, `ai.platform_key_decrypt_failed`. */
  readonly onEvent?: (event: string) => void;
}

export const PLATFORM_SETTINGS_TTL_MS = 30_000;
/** Yükleme başarısızken eski değerle servis edilen en uzun süre (sonra hata verilir; sınır gevşetilmez). */
const STALE_MAX_MS = 300_000;
const RETRY_AFTER_FAIL_MS = 5_000;

const DISABLED: PlatformSnapshot = {
  enabled: false,
  apiKey: null,
  label: null,
  source: null,
  limits: NO_PLATFORM_LIMITS,
};

export function createPlatformSettings(deps: PlatformSettingsDeps): PlatformSettingsProvider {
  const ttl = deps.ttlMs ?? PLATFORM_SETTINGS_TTL_MS;
  let cached: { snapshot: PlatformSnapshot; fetchedAt: number; validUntil: number } | null = null;
  let inflight: Promise<PlatformSnapshot> | null = null;
  /** Çözülmüş DB anahtarı; şifreli değer değişmedikçe yeniden çözülmez. */
  let decrypted: { enc: Buffer; version: number; apiKey: string | null } | null = null;

  function dbKeyOf(row: PlatformSettingsRow): string | null {
    if (row.keyEnc === null || row.keyVersion === null) {
      decrypted = null;
      return null;
    }
    if (
      decrypted !== null &&
      decrypted.version === row.keyVersion &&
      decrypted.enc.equals(row.keyEnc)
    ) {
      return decrypted.apiKey;
    }
    const derived = derivePlatformKey(deps.kek);
    try {
      const apiKey = decryptField(derived, platformKeyContext(row.keyVersion), row.keyEnc);
      decrypted = { enc: Buffer.from(row.keyEnc), version: row.keyVersion, apiKey };
      return apiKey;
    } catch {
      // Çözülemeyen kayıt (yanlış KEK/bozuk veri): sır dosyasına düşülür, durum içeriksiz loglanır.
      deps.onEvent?.('ai.platform_key_decrypt_failed');
      decrypted = { enc: Buffer.from(row.keyEnc), version: row.keyVersion, apiKey: null };
      return null;
    } finally {
      wipe(derived);
    }
  }

  function snapshotOf(row: PlatformSettingsRow): PlatformSnapshot {
    const limits: PlatformLimits = {
      userTurnsPerDay: row.userTurnsPerDay,
      userTokensPerDay: row.userTokensPerDay,
      orgDailyCapMicroUsd: row.orgDailyCapMicroUsd,
      platformDailyCapMicroUsd: row.platformDailyCapMicroUsd,
    };
    if (!row.fallbackEnabled) return { ...DISABLED, limits };
    const dbKey = dbKeyOf(row);
    if (dbKey !== null) {
      return { enabled: true, apiKey: dbKey, label: row.keyLabel, source: 'panel', limits };
    }
    const fileKey = deps.readFileKey();
    if (fileKey !== null) {
      return { enabled: true, apiKey: fileKey, label: null, source: 'server_secret', limits };
    }
    return { enabled: true, apiKey: null, label: null, source: null, limits };
  }

  async function refresh(): Promise<PlatformSnapshot> {
    const t = deps.now();
    try {
      const snapshot = snapshotOf(await deps.load());
      cached = { snapshot, fetchedAt: t, validUntil: t + ttl };
      return snapshot;
    } catch (err) {
      deps.onEvent?.('ai.platform_settings_load_failed');
      if (cached !== null && t - cached.fetchedAt <= STALE_MAX_MS) {
        cached = { ...cached, validUntil: t + RETRY_AFTER_FAIL_MS };
        return cached.snapshot;
      }
      throw err;
    }
  }

  return {
    async get() {
      if (!deps.envGate) return DISABLED;
      if (cached !== null && deps.now() < cached.validUntil) return cached.snapshot;
      inflight ??= refresh().finally(() => {
        inflight = null;
      });
      return inflight;
    },
    invalidate() {
      cached = null;
    },
  };
}

/** Testler ve sabit yapılandırma için: önbelleksiz, değişmeyen sağlayıcı. */
export function staticPlatformSettings(opts: {
  readonly apiKey: string | null;
  readonly label?: string | null;
  readonly limits?: Partial<PlatformLimits>;
  readonly enabled?: boolean;
}): PlatformSettingsProvider {
  const enabled = opts.enabled ?? true;
  const snapshot: PlatformSnapshot = enabled
    ? {
        enabled: true,
        apiKey: opts.apiKey,
        label: opts.label ?? null,
        source: opts.apiKey === null ? null : 'panel',
        limits: { ...NO_PLATFORM_LIMITS, ...opts.limits },
      }
    : { ...DISABLED, limits: { ...NO_PLATFORM_LIMITS, ...opts.limits } };
  return { get: async () => snapshot, invalidate: () => undefined };
}
