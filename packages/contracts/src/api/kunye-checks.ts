// Künye Kontrolü uç sözleşmeleri (025 §14; P13.12; 002 §15). Görünüm yalnız künye içeren paragrafları
// ve ±1 komşusunu taşır; belgenin tamamı dönmez. Künye metni sunucuda kayıttan biçimlenir (081).
import { z } from 'zod';
import { KUNYE_CHECK_STATUSES, KUNYE_STATUSES } from '../enums.ts';

export const KUNYE_CHECK_ITEM_KINDS = ['decision', 'article', 'authority'] as const;

export const KUNYE_CHECK_REASONS = [
  'impossible',
  'not_in_coverage',
  'source_error',
  'budget_exceeded',
  'near_miss',
] as const;

/** Geliştirme/test düz metin bağdaştırıcısı (P13.12 K6): dosya alım portu bağlanana dek metin alanı. */
export const KunyeCheckTextLimits = { minChars: 20, maxChars: 200_000 } as const;

export const KunyeCheckOccurrence = z.object({
  paragraph: z.number().int().nonnegative(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

export const KunyeCheckResult = z.object({
  id: z.string(),
  kind: z.enum(KUNYE_CHECK_ITEM_KINDS),
  raw: z.string(),
  status: z.enum(KUNYE_STATUSES),
  reason: z.enum(KUNYE_CHECK_REASONS).nullable(),
  /** Doğrulanan kaydın tam künyesi (081 tam stil) veya madde atfı ("TBK m. 352"). */
  kunye: z.string().nullable(),
  /** Resmî kaynakta bulunan en yakın kayıt (esas veya karar eşit, başka bileşen farklı). */
  nearMiss: z
    .object({
      kunye: z.string(),
      diffs: z.array(z.enum(['chamber', 'esas', 'karar', 'date'])),
    })
    .nullable(),
  source: z.enum(['bedesten', 'anayasa', 'uyusmazlik', 'mevzuat']).nullable(),
  url: z.url().nullable(),
  /** Mevzuat ekranı yolu (`/mevzuat/6098/352`) veya karar ekranı yolu. */
  href: z.string().nullable(),
  occurrences: z.array(KunyeCheckOccurrence),
});
export type KunyeCheckResult = z.infer<typeof KunyeCheckResult>;

export const KunyeCheckParagraph = z.object({
  no: z.number().int().nonnegative(),
  text: z.string(),
});

export const KunyeCheckViewDto = z.object({
  checkId: z.uuid(),
  status: z.enum(KUNYE_CHECK_STATUSES),
  summary: z.object({
    distinct: z.number().int().nonnegative(),
    verified: z.number().int().nonnegative(),
    attention: z.number().int().nonnegative(),
    excluded: z.number().int().nonnegative(),
    notChecked: z.number().int().nonnegative(),
    progress: z.object({ done: z.number().int(), total: z.number().int() }),
  }),
  results: z.array(KunyeCheckResult),
  paragraphs: z.array(KunyeCheckParagraph),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type KunyeCheckViewDto = z.infer<typeof KunyeCheckViewDto>;

export const KunyeCheckCreated = z.object({ checkId: z.uuid() });
export type KunyeCheckCreated = z.infer<typeof KunyeCheckCreated>;
