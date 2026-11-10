// Yönetim yüzeyi "Yapay zekâ anahtar ataması" sözleşmeleri (`/api/v1/admin/ai/keys/*`).
// Süper yönetici bir büroya/baroya ya da kullanıcıya Anthropic API anahtarı atar veya siler. Anahtar
// yalnız atama isteğinde gider; HİÇBİR yanıt anahtarı taşımaz: yalnız tanımlı/yok, son 4 karakter ve
// güncellenme zamanı döner. Yanıtlar içeriksizdir (sohbet, belge, dosya adı yok).
import { z } from 'zod';
import { VERIFICATION_STATUSES } from '../enums.ts';
import { AI_API_KEY_PATTERN } from './ai-keys.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

export const AdminAiKeySlotDto = z.strictObject({
  configured: z.boolean(),
  /** Anahtarın son 4 karakteri; tanımlı değilse `null`. */
  last4: z
    .string()
    .regex(/^[A-Za-z0-9_-]{4}$/)
    .nullable(),
  updatedAt: IsoDateTime.nullable(),
});
export type AdminAiKeySlotDtoValue = z.infer<typeof AdminAiKeySlotDto>;

export const AdminAiKeyOrgItemDto = z.strictObject({
  orgId: z.uuid(),
  shortId: z.string().regex(/^[0-9a-f]{8}$/),
  /** Büro/baro adı (takma ad `orgLabel`). */
  orgLabel: z.string(),
  orgKind: z.string(),
  key: AdminAiKeySlotDto,
});
export type AdminAiKeyOrgItemDtoValue = z.infer<typeof AdminAiKeyOrgItemDto>;

export const AdminAiKeyUserItemDto = z.strictObject({
  userId: z.uuid(),
  shortId: z.string().regex(/^[0-9a-f]{8}$/),
  userEmail: z.string(),
  verificationStatus: z.enum(VERIFICATION_STATUSES),
  /** Kullanıcının seçtiği kaynak (`org` = büro anahtarı, `own` = kendi anahtarı). */
  source: z.enum(['org', 'own']),
  key: AdminAiKeySlotDto,
});
export type AdminAiKeyUserItemDtoValue = z.infer<typeof AdminAiKeyUserItemDto>;

/** `GET .../keys/orgs|users`: arama metni URL'de taşınmaz (`POST .../search`). */
export const AdminAiKeyListQuery = z.strictObject({
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type AdminAiKeyListQueryValue = z.infer<typeof AdminAiKeyListQuery>;

export const AdminAiKeySearchInput = z.strictObject({
  query: z.string().trim().min(2).max(254),
  limit: z.number().int().min(1).max(50).optional(),
});
export type AdminAiKeySearchInputValue = z.infer<typeof AdminAiKeySearchInput>;

export const AdminAiKeyOrgListResponse = z.strictObject({ items: z.array(AdminAiKeyOrgItemDto) });
export type AdminAiKeyOrgListResponseValue = z.infer<typeof AdminAiKeyOrgListResponse>;
export const AdminAiKeyUserListResponse = z.strictObject({
  items: z.array(AdminAiKeyUserItemDto),
});
export type AdminAiKeyUserListResponseValue = z.infer<typeof AdminAiKeyUserListResponse>;

/** Platform sınırlarının izinli aralıkları (DB kısıtlarıyla aynı; `app.platform_settings`). */
export const PLATFORM_LIMIT_BOUNDS = {
  userTurnsPerDay: { min: 1, max: 10_000 },
  userTokensPerDay: { min: 1_000, max: 100_000_000 },
  orgDailyCapMicroUsd: { min: 100_000, max: 10_000_000_000 },
} as const;

/** Platform GENELİ günlük harcama tavanı aralığı, mikro-USD (1-100000 USD; DB kısıtıyla aynı). */
export const PLATFORM_CAP_BOUNDS = { min: 1_000_000, max: 100_000_000_000 } as const;

/** Platform anahtarının görünen adı: 3-60 karakter düz metin (denetim karakteri ve `<` `>` yok). */
export const PlatformKeyLabel = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .regex(/^[^\p{Cc}<>]+$/u);

/** `PUT .../keys/platform/key`: anahtar yalnız bu istekte gider; hiçbir yanıt taşımaz. */
export const AdminAiPlatformKeyInput = z.strictObject({
  apiKey: z.string().trim().regex(AI_API_KEY_PATTERN),
  label: PlatformKeyLabel,
});
export type AdminAiPlatformKeyInputValue = z.infer<typeof AdminAiPlatformKeyInput>;

/** `PUT .../keys/platform/key/label`: anahtarı yeniden girmeden yalnız adı değiştirir. */
export const AdminAiPlatformLabelInput = z.strictObject({ label: PlatformKeyLabel });

/** `PUT .../keys/platform/fallback`: yumuşak düşüş anahtarı (env bayrağı sert kapıdır). */
export const AdminAiPlatformFallbackInput = z.strictObject({ enabled: z.boolean() });

const bounded = (b: { readonly min: number; readonly max: number }) =>
  z.number().int().min(b.min).max(b.max).nullable();

/** `PUT .../keys/platform/limits`: üçü birlikte yazılır; `null` = yapılandırma zinciri (varsayılan). */
export const AdminAiPlatformLimitsInput = z.strictObject({
  userTurnsPerDay: bounded(PLATFORM_LIMIT_BOUNDS.userTurnsPerDay),
  userTokensPerDay: bounded(PLATFORM_LIMIT_BOUNDS.userTokensPerDay),
  orgDailyCapMicroUsd: bounded(PLATFORM_LIMIT_BOUNDS.orgDailyCapMicroUsd),
});
export type AdminAiPlatformLimitsInputValue = z.infer<typeof AdminAiPlatformLimitsInput>;

/**
 * `PUT .../keys/platform/cap`: platform geneli günlük harcama tavanı (tüm kullanıcıların toplamı; aşımda
 * ortak anahtar turları başlamaz). `null` = yapılandırma varsayılanı (`costGuard.platformDailyCapMicroUsd`).
 * Kill-switch davranışı bu değerden bağımsızdır.
 */
export const AdminAiPlatformCapInput = z.strictObject({
  platformDailyCapMicroUsd: bounded(PLATFORM_CAP_BOUNDS),
});
export type AdminAiPlatformCapInputValue = z.infer<typeof AdminAiPlatformCapInput>;

const nonNegInt = z.number().int().min(0);

/**
 * Platform ortak anahtarı kartı: sert kapı (env), yumuşak anahtar, anahtar durumu (DEĞER ASLA dönmez; yalnız
 * ad, son 4 hane, zaman), son 24 saat toplamı ve limitler (varsayılan, panel değeri, geçerli değer).
 */
export const AdminAiPlatformKeyDto = z.strictObject({
  /** Sert kapı: `PLATFORM_AI_KEY_FALLBACK` açık ve ortam izinli mi (production/staging/onprem'de hep `false`). */
  fallbackEnabled: z.boolean(),
  /** Yumuşak anahtar: panelden açılıp kapanır (`platform_settings.fallback_enabled`). */
  fallbackSwitch: z.boolean(),
  /** Panelde veya sunucu sır dosyasında bir anahtar tanımlı mı. */
  keyConfigured: z.boolean(),
  /** Düşüş şu an fiilen açık mı (sert kapı + yumuşak anahtar + anahtar tanımlı). */
  active: z.boolean(),
  key: z.strictObject({
    /** `panel` = yönetimden girilen (şifreli DB), `server_secret` = sunucu sır dosyası, `null` = yok. */
    source: z.enum(['panel', 'server_secret']).nullable(),
    label: z.string().nullable(),
    last4: z
      .string()
      .regex(/^[A-Za-z0-9_-]{4}$/)
      .nullable(),
    updatedAt: IsoDateTime.nullable(),
  }),
  last24h: z.strictObject({
    turns: nonNegInt,
    users: nonNegInt,
    orgs: nonNegInt,
    tokens: nonNegInt,
    estimatedCostMicroUsd: nonNegInt,
  }),
  /** Geçerli günlük sınırlar (kullanıcı ve büro geçersiz kılmaları ayrıca uygulanır). */
  limits: z.strictObject({
    userTurnsPerDay: nonNegInt,
    userTokensPerDay: nonNegInt,
    /** Panelde düz büro tavanı verildiyse değeri; `null` = koltuk sayılı `costGuard` formülü. */
    orgDailyCapMicroUsd: nonNegInt.nullable(),
    estimatedMicroUsdPerMtok: nonNegInt,
    /** Geçerli platform geneli günlük harcama tavanı (panel değeri ya da yapılandırma varsayılanı). */
    platformDailyCapMicroUsd: nonNegInt,
    /** Panelde girilen değerler; `null` = varsayılan. */
    custom: z.strictObject({
      userTurnsPerDay: nonNegInt.nullable(),
      userTokensPerDay: nonNegInt.nullable(),
      orgDailyCapMicroUsd: nonNegInt.nullable(),
      platformDailyCapMicroUsd: nonNegInt.nullable(),
    }),
    /** Yapılandırma varsayılanları. */
    defaults: z.strictObject({
      userTurnsPerDay: nonNegInt,
      userTokensPerDay: nonNegInt,
      orgDailyCapFloorMicroUsd: nonNegInt,
      orgDailyCapPerSeatMicroUsd: nonNegInt,
      platformDailyCapMicroUsd: nonNegInt,
    }),
  }),
});
export type AdminAiPlatformKeyDtoValue = z.infer<typeof AdminAiPlatformKeyDto>;
