// Yapay zekâ API anahtarı uçlarının sözleşmeleri (#54 BYOK; 042 §8.2 `org:ai_policy_write`). Anahtar yalnız
// isteklerde gider; yanıtlar anahtarın kendisini ASLA taşımaz, yalnız son 4 karakteri ve durumunu verir.
import { z } from 'zod';
import { AI_KEY_SOURCES } from '../enums.ts';

export type { AiKeySource } from '../enums.ts';
export { AI_KEY_SOURCES };

/** Anthropic anahtar biçimi (ön denetim; asıl doğrulama sağlayıcıya yapılan çağrıdır). */
export const AI_API_KEY_PATTERN = /^sk-ant-[A-Za-z0-9_-]{20,300}$/;

export const AiApiKeyInput = z.strictObject({
  apiKey: z.string().trim().regex(AI_API_KEY_PATTERN),
});
export type AiApiKeyInputValue = z.infer<typeof AiApiKeyInput>;

export const AiKeySourceInput = z.strictObject({ source: z.enum(AI_KEY_SOURCES) });
export type AiKeySourceInputValue = z.infer<typeof AiKeySourceInput>;

const IsoDateTime = z.iso.datetime({ offset: true });

export const AiKeySlotDto = z.strictObject({
  configured: z.boolean(),
  /** Anahtarın son 4 karakteri; tanımlı değilse `null`. */
  last4: z
    .string()
    .regex(/^[A-Za-z0-9_-]{4}$/)
    .nullable(),
  verifiedAt: IsoDateTime.nullable(),
});

export const AiKeysStatusDto = z.strictObject({
  org: AiKeySlotDto,
  own: AiKeySlotDto,
  source: z.enum(AI_KEY_SOURCES),
  /** Rol büro anahtarını değiştirebilir mi (`org:ai_policy_write`). */
  canManageOrg: z.boolean(),
  /** Sohbet şu an çalışabilir mi (seçili kaynakta anahtar var ya da platform ortak anahtarı açık). */
  usable: z.boolean(),
  /** Bir sonraki turda kullanılacak anahtarın kaynağı; yoksa `null`. `platform` = sunucunun ortak anahtarı. */
  effectiveSource: z.enum(['org', 'own', 'platform']).nullable(),
  /** Platform ortak anahtarı bu ortamda açık ve tanımlı mı (`PLATFORM_AI_KEY_FALLBACK`). */
  platformFallback: z.boolean(),
  /** Ortak anahtarın yönetimde verilen görünen adı ("Şu an <ad> kullanılıyor"); ad yoksa veya düşüş kapalıysa `null`. */
  platformLabel: z.string().max(60).nullable(),
});
export type AiKeysStatusDtoValue = z.infer<typeof AiKeysStatusDto>;
