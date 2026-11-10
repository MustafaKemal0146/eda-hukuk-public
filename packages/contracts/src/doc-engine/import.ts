// doc-engine içe aktarma sözleşmesi (084 §7, 033 §7.7; P19a.5). Uç ve okuyucular P19b'dedir;
// burada yalnız yanıt şekilleri vardır. `docAst` alanı `docast.schema.json`'a başvurur.
import { z } from 'zod';
import { DocAst } from '../docast.ts';
import { HIDDEN_CONTENT_KINDS } from '../enums.ts';

export const IMPORT_FILE_TYPES = ['udf', 'docx'] as const;
export type ImportFileType = (typeof IMPORT_FILE_TYPES)[number];

/** 033 `ExtractResult.rejectReason` ile aynı küme (`encrypted_pdf` hariç; PDF içe aktarılmaz). */
export const IMPORT_REJECT_REASONS = [
  'zip_bomb',
  'zip_slip',
  'xxe_blocked',
  'macro_detected',
  'corrupt',
  'unsupported_structure',
  'page_limit',
] as const;
export type ImportRejectReason = (typeof IMPORT_REJECT_REASONS)[number];

/** Gizli içerik raporu (033 §7.7 kanonik JSON); `excerpt` en çok 200 karakter düz metin. */
export const HiddenContentReport = z.strictObject({
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
});
export type HiddenContentReportDto = z.infer<typeof HiddenContentReport>;

export const ImportEngineReport = z.strictObject({
  droppedFeatures: z.array(z.strictObject({ feature: z.string(), count: z.number().int() })),
  hiddenContentSkipped: z.number().int(),
  invisibleUnicodeRemoved: z.number().int(),
  sourcePage: z.strictObject({
    marginsPt: z.array(z.number()).length(4).nullable(),
    orientation: z.enum(['portrait', 'landscape']).nullable(),
  }),
  warnings: z.array(z.string()),
});
export type ImportEngineReportDto = z.infer<typeof ImportEngineReport>;

export const ImportResult = z.strictObject({
  jobId: z.uuid(),
  verdict: z.enum(['ok', 'reject']),
  rejectReason: z.enum(IMPORT_REJECT_REASONS).nullable(),
  fileType: z.enum(IMPORT_FILE_TYPES),
  /** Tek `freeSection` (084 §4.3); reddedilen girdide `null`. */
  docAst: DocAst.nullable(),
  report: ImportEngineReport,
  hiddenContent: HiddenContentReport,
});
export type ImportResultDto = z.infer<typeof ImportResult>;
