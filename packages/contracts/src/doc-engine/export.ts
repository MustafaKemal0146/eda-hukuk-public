// doc-engine dışa aktarım sözleşmesi (084 §7; P19a.5). Çağıran yalnız worker'dır.
// `gen:schemas` bu dosyadaki Zod şemalarını tek `export.schema.json` içinde `$defs` olarak yazar;
// `docAst` alanı `docast.schema.json`'a başvurur (DocAST burada çoğaltılmaz).
import { z } from 'zod';
import { DocAst } from '../docast.ts';

export const EXPORT_FORMATS = ['udf', 'docx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/**
 * `ExportReport.degraded[].feature` değerleri (084 §4.2, "Yeni tanımlanan adlar"). Şemada serbest
 * dizedir (084 §7 aynen); doc-engine yalnız bu kümeyi yazar. Son ikisi D5/D7 raporudur.
 */
export const EXPORT_DEGRADED_FEATURES = [
  'strike',
  'hyperlink',
  'hard_break_as_paragraph',
  'list_start',
  'keep_together',
  'page_number',
  'forbidden_char',
  'hyperlink_protocol',
] as const;
export type ExportDegradedFeature = (typeof EXPORT_DEGRADED_FEATURES)[number];

export const ExportRequest = z.strictObject({
  jobId: z.uuid(),
  format: z.enum(EXPORT_FORMATS),
  docAst: DocAst,
  options: z.strictObject({
    pageNumbers: z.boolean(),
    /** Yalnız test: aynı DocAST + aynı zaman damgası -> aynı UDF/DOCX baytları (084 İ3). */
    fixedTimestamp: z.iso.datetime().nullable(),
  }),
});
export type ExportRequestDto = z.infer<typeof ExportRequest>;

export const ExportReport = z.strictObject({
  degraded: z.array(z.strictObject({ feature: z.string(), count: z.number().int() })),
  /** Yalnız `pdf`. */
  pageCount: z.number().int().nullable(),
  docEngineVersion: z.string(),
  gotenbergVersion: z.string().nullable(),
});
export type ExportReportDto = z.infer<typeof ExportReport>;

export const ExportResult = z.strictObject({
  jobId: z.uuid(),
  format: z.enum(EXPORT_FORMATS),
  sizeBytes: z.number().int(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  report: ExportReport,
});
export type ExportResultDto = z.infer<typeof ExportResult>;

/**
 * doc-engine hata gövdesi (iç sözleşme; yalnız worker okur). `invalid_docast` ve `forbidden_phrase`
 * 084 §3.2 D1/D6; diğerleri . Mesaj Türkçedir, belge içeriği taşımaz.
 */
export const DOC_ENGINE_ERROR_CODES = [
  'unauthorized',
  'invalid_docast',
  'forbidden_phrase',
  'payload_too_large',
  'not_found',
  'export_failed',
  'extract_failed',
  'timeout',
] as const;
export type DocEngineErrorCode = (typeof DOC_ENGINE_ERROR_CODES)[number];

export const DocEngineError = z.strictObject({
  code: z.enum(DOC_ENGINE_ERROR_CODES),
  message: z.string(),
});
export type DocEngineErrorDto = z.infer<typeof DocEngineError>;
