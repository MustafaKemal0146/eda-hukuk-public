// Yönetim yüzeyi "Yapay zekâ" modülü sözleşmeleri (`/api/v1/admin/ai/*`). Yanıtlar içeriksizdir:
// sağlayıcı/model katalog meta verisi, toplulaştırılmış sayaçlar ve istem sürüm özeti taşır. Sır DEĞERİ
// veya sağlayıcı model kimliği taşımaz; sağlayıcı anahtarı için yalnız "yapılandırıldı/yok" bilgisi
// döner. Veri sınıfı izinleri salt okurdur (yazma ucu yalnız model etkin/pasif anahtarıdır).
import { z } from 'zod';
import { DATA_CLASSES } from '../enums.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

export const AdminAiProviderDto = z.strictObject({
  id: z.string(),
  kind: z.string(),
  region: z.string(),
  enabled: z.boolean(),
  priority: z.number().int(),
  allowedDataClasses: z.array(z.enum(DATA_CLASSES)),
  transferBasis: z.string().nullable(),
  trainingUse: z.boolean(),
  humanReview: z.boolean(),
  retentionDays: z.number().int().nullable(),
  /** `true` anahtar kaynağı dolu, `false` yok, `null` anahtar gerektirmez (simülasyon). */
  secretConfigured: z.boolean().nullable(),
});
export type AdminAiProviderDtoValue = z.infer<typeof AdminAiProviderDto>;

export const AdminAiModelDto = z.strictObject({
  id: z.uuid(),
  alias: z.string(),
  providerId: z.string(),
  label: z.string(),
  thinking: z.string(),
  maxOutputTokens: z.number().int(),
  contextBudget: z.number().int(),
  capabilities: z.strictObject({ tools: z.boolean(), strictTools: z.boolean() }),
  enabled: z.boolean(),
  priority: z.number().int(),
  evalGatePassedAt: IsoDateTime.nullable(),
});
export type AdminAiModelDtoValue = z.infer<typeof AdminAiModelDto>;

export const AdminAiCatalogResponse = z.strictObject({
  providers: z.array(AdminAiProviderDto),
  models: z.array(AdminAiModelDto),
  /** Kod içi katalog anlık görüntüsünde olup veritabanında kaydı bulunmayanlar (değiştirilemez). */
  notInDb: z.strictObject({
    providers: z.array(z.string()),
    models: z.array(
      z.strictObject({ alias: z.string(), providerId: z.string(), label: z.string() }),
    ),
  }),
});
export type AdminAiCatalogResponseValue = z.infer<typeof AdminAiCatalogResponse>;

export const AdminAiUsageItem = z.strictObject({
  alias: z.string(),
  providerId: z.string(),
  calls: z.number().int(),
  errors: z.number().int(),
  /** 0..1; çağrı yoksa 0. */
  errorRate: z.number().min(0).max(1),
  avgLatencyMs: z.number().int().nullable(),
});
export const AdminAiUsageResponse = z.strictObject({
  windowDays: z.number().int(),
  items: z.array(AdminAiUsageItem),
});
export type AdminAiUsageResponseValue = z.infer<typeof AdminAiUsageResponse>;

export const AdminAiPromptDto = z.strictObject({
  key: z.string(),
  version: z.number().int(),
  chars: z.number().int(),
  /** İstem metninin SHA-256 özeti (hex). */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export const AdminAiPromptsResponse = z.strictObject({ items: z.array(AdminAiPromptDto) });
export type AdminAiPromptsResponseValue = z.infer<typeof AdminAiPromptsResponse>;

export const AdminAiPromptTextResponse = z.strictObject({
  key: z.string(),
  version: z.number().int(),
  text: z.string(),
});
export type AdminAiPromptTextResponseValue = z.infer<typeof AdminAiPromptTextResponse>;

export const SetAiModelEnabledInput = z.strictObject({ enabled: z.boolean() });
export type SetAiModelEnabledInputValue = z.infer<typeof SetAiModelEnabledInput>;

export const SetAiModelEnabledResult = z.strictObject({
  id: z.uuid(),
  enabled: z.boolean(),
  changed: z.boolean(),
});
export type SetAiModelEnabledResultValue = z.infer<typeof SetAiModelEnabledResult>;
