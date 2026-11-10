// doc-engine metin çıkarma sözleşmesi (033 §7.4 `ExtractResult`; P21 dosyayla sohbet ilk dilimi).
// Çağıran yalnız worker'dır (`POST /v1/extract`, gövde ham bayt). Bu dilimde yalnız metin katmanlı
// PDF, DOCX ve TXT okunur; OCR, `sections` ve türev (`searchable`/`clean`) yoktur. Metin
// katmanı olmayan PDF `verdict: ok` + `hasTextLayer: false` döner; worker evrakı `ocr_skipped` yapar.
import { z } from 'zod';
import { HIDDEN_CONTENT_KINDS } from '../enums.ts';

/** Bu dilimde çıkarılabilen türler (033 §7.4 kümesinin alt kümesi). */
export const EXTRACT_FILE_TYPES = ['pdf', 'docx', 'txt'] as const;
export type ExtractFileType = (typeof EXTRACT_FILE_TYPES)[number];

/** 033 §7.4 `rejectReason` kümesi. */
export const EXTRACT_REJECT_REASONS = [
  'zip_bomb',
  'zip_slip',
  'xxe_blocked',
  'macro_detected',
  'encrypted_pdf',
  'corrupt',
  'unsupported_structure',
  'page_limit',
] as const;
export type ExtractRejectReason = (typeof EXTRACT_REJECT_REASONS)[number];

/** İstek başlıkları (033 §7.4). */
export const EXTRACT_HEADERS = {
  jobId: 'X-Eda-Job-Id',
  fileType: 'X-Eda-File-Type',
  maxPages: 'X-Eda-Max-Pages',
} as const;

export const ExtractResult = z.strictObject({
  jobId: z.uuid(),
  verdict: z.enum(['ok', 'reject']),
  rejectReason: z.enum(EXTRACT_REJECT_REASONS).nullable(),
  fileType: z.enum(EXTRACT_FILE_TYPES),
  pageCount: z.number().int().nonnegative().nullable(),
  hasTextLayer: z.boolean(),
  /** Gizli içerik HARİÇ düz metin; reddedilen veya metinsiz girdide boş. */
  text: z.string(),
  textTruncated: z.boolean(),
  /** Her sayfanın `text` içindeki başlangıç ofseti (PDF); diğer türlerde boş. */
  pageOffsets: z.array(z.number().int().nonnegative()),
  hiddenContent: z.strictObject({
    found: z.boolean(),
    excludedFromText: z.boolean(),
    items: z.array(
      z.strictObject({
        kind: z.enum(HIDDEN_CONTENT_KINDS),
        page: z.number().int().nullable(),
        charCount: z.number().int(),
        excerpt: z.string().max(200),
      }),
    ),
  }),
  extractorVersion: z.string().min(1).max(64),
});
export type ExtractResultDto = z.infer<typeof ExtractResult>;
