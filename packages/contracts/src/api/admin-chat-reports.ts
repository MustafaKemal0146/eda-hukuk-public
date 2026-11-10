// Yönetim yüzeyi "Sohbetler ve raporlar" sözleşmeleri (P27; 053-ekranlar/11). KRİTİK GİZLİLİK: sohbet ve
// mesaj İÇERİĞİ (metin, başlık, özet, künye, araç argümanı), kullanıcı kimliği ve büro kimliği bu
// sözleşmede YOKTUR; `strictObject` fazladan alanı reddeder. Yalnız toplulaştırılmış sayılar ve kod
// değerleri (takma ad, araç adı, kaynak türü, geri bildirim kategorisi) taşınır.
import { z } from 'zod';
import { FEEDBACK_CATEGORIES, SOURCE_KINDS, SOURCE_ORIGINS, TOOL_CALL_NAMES } from '../enums.ts';
import { MODEL_ALIASES } from '../stream/requests.ts';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Count = z.number().int().nonnegative();

export const ChatReportsQuery = z.strictObject({ from: IsoDate, to: IsoDate });
export type ChatReportsQueryValue = z.infer<typeof ChatReportsQuery>;

export const ChatReportDailyDto = z.strictObject({
  day: IsoDate,
  conversations: Count,
  messages: Count,
  userMessages: Count,
  turns: Count,
  turnErrors: Count,
  avgTurnSeconds: z.number().nullable(),
  activeOrgs: Count,
  chatCalls: Count,
  petitionCalls: Count,
  sourcesDecision: Count,
  sourcesLegislation: Count,
  feedbackUp: Count,
  feedbackDown: Count,
});
export type ChatReportDailyDtoValue = z.infer<typeof ChatReportDailyDto>;

export const ChatReportModeDto = z.strictObject({
  mode: z.enum(['chat', 'petition']),
  calls: Count,
  errors: Count,
});

export const ChatReportAliasDto = z.strictObject({
  alias: z.enum(MODEL_ALIASES),
  turns: Count,
  errors: Count,
});

export const ChatReportToolDto = z.strictObject({
  tool: z.enum(TOOL_CALL_NAMES),
  calls: Count,
  errors: Count,
  errorRate: z.number().min(0).max(1),
  avgDurationMs: Count,
});

export const ChatReportSourceDto = z.strictObject({
  kind: z.enum(SOURCE_KINDS),
  count: Count,
});

export const ChatReportSourceOriginDto = z.strictObject({
  origin: z.enum(SOURCE_ORIGINS),
  count: Count,
});

export const ChatReportFeedbackCategoryDto = z.strictObject({
  category: z.enum([...FEEDBACK_CATEGORIES, 'none']),
  count: Count,
});

export const ChatReportOrgKindDto = z.strictObject({
  kind: z.enum(['individual', 'firm']),
  conversations: Count,
});

export const ChatReportsResponse = z.strictObject({
  from: IsoDate,
  to: IsoDate,
  daily: z.array(ChatReportDailyDto),
  modes: z.array(ChatReportModeDto),
  aliases: z.array(ChatReportAliasDto),
  tools: z.array(ChatReportToolDto),
  sources: z.array(ChatReportSourceDto),
  sourceOrigins: z.array(ChatReportSourceOriginDto),
  feedback: z.strictObject({
    up: Count,
    down: Count,
    downCategories: z.array(ChatReportFeedbackCategoryDto),
  }),
  orgKinds: z.array(ChatReportOrgKindDto),
  /** Bu dönemde veri kaynağı bulunmayan göstergeler (uydurma tablo yok; boş kalanlar açıkça belirtilir). */
  unavailable: z.array(z.enum(['masking_notices'])),
});
export type ChatReportsResponseValue = z.infer<typeof ChatReportsResponse>;
