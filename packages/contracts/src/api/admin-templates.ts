// Yönetim paneli "Şablonlar" modülü sözleşmeleri (salt okur). Şablonlar kodda sürümlenir; panel
// envanter ve SENTETİK örnek önizleme (düz metin) gösterir, düzenleme yoktur. İçerik, gerçek alıcı veya
// belirteç taşımaz.
import { z } from 'zod';

export const TEMPLATE_VARIABLE_TYPES = ['number', 'string', 'datetime', 'enum'] as const;

export const AdminTemplateVariableDto = z.strictObject({
  name: z.string(),
  type: z.enum(TEMPLATE_VARIABLE_TYPES),
  options: z.array(z.string()),
  /** Mühürlü sır: değer hiçbir yerde gösterilmez. */
  sealed: z.boolean(),
});
export type AdminTemplateVariableDtoValue = z.infer<typeof AdminTemplateVariableDto>;

export const TEMPLATE_TYPES = ['email', 'document'] as const;

export const AdminTemplateItemDto = z.strictObject({
  /** Tekil anahtar: e-posta için şablon kodu, belge için kimlik. */
  key: z.string(),
  type: z.enum(TEMPLATE_TYPES),
  /** E-posta: bildirim türü; belge: şablon türü (`petition|notice|memo|free`). */
  kind: z.string(),
  /** E-posta: bildirim sınıfı; belge: dava türü kodu. */
  group: z.string().nullable(),
  version: z.string(),
  /** Son değişiklik: e-postada sürüm tarihi (`YYYY-MM-DD`), belgede ISO zaman. */
  lastChanged: z.string().nullable(),
  /** E-posta kataloğunda uygulanmamış kodlar `false` (planlanmış, işlenemez). */
  implemented: z.boolean(),
  active: z.boolean().nullable(),
  /** Önizleme yalnız uygulanmış e-posta şablonlarında vardır. */
  previewable: z.boolean(),
  variables: z.array(AdminTemplateVariableDto),
});
export type AdminTemplateItemDtoValue = z.infer<typeof AdminTemplateItemDto>;

export const AdminTemplateListResponse = z.strictObject({
  items: z.array(AdminTemplateItemDto),
  /** Belge şablonlarının başlık/gövde/değişken bilgisi okunmaz (içerik sınırı). */
  documentContentHidden: z.literal(true),
});
export type AdminTemplateListResponseValue = z.infer<typeof AdminTemplateListResponse>;

export const AdminTemplatePreviewDto = z.strictObject({
  key: z.string(),
  version: z.string(),
  subject: z.string(),
  text: z.string(),
  /** Önizleme yalnız sentetik örnek verilerle üretilir. */
  synthetic: z.literal(true),
});
export type AdminTemplatePreviewDtoValue = z.infer<typeof AdminTemplatePreviewDto>;
