// UI Message Stream data part şemaları (022 §5.4; 002 §14). Tam 8 kanonik ad; yazıcı Zod ile doğrular.
// Aynı `type` + `id` ile yazılan parça öncekinin yerine geçer; `data-pipeline` geçicidir (transient).
import { z } from 'zod';
import {
  CREDIT_OP_CODES,
  DOCUMENT_KINDS,
  EDIT_OP_TYPES,
  KUNYE_STATUSES,
  NOTICE_CODES,
  PIPELINE_STAGES,
  PIPELINE_STATUSES,
  SECTION_ROLES,
  SOURCE_CODES,
  SOURCE_KINDS,
} from '../enums.ts';
import { COURT_TYPES } from '../tools/common.ts';

export const SourceRefPattern = /^K[1-9]\d*$/;
const Ref = z.string().regex(SourceRefPattern);

export const PipelineData = z.object({
  stage: z.enum(PIPELINE_STAGES),
  status: z.enum(PIPELINE_STATUSES),
  label: z.string(),
  progress: z
    .object({ done: z.number().int(), total: z.number().int(), unit: z.enum(['page', 'item']) })
    .optional(),
  queue: z.object({ position: z.number().int(), etaSec: z.number().int() }).optional(),
  toolName: z.string().optional(),
  // paralel araç çağrılarını ayırt etmek için çağrı kimliği ve sunucunun ürettiği ayrıntı
  // (ör. getirilen kararın künyesi). Ayrıntı yalnız kayıttan render edilir; model metni/araç girdisi YAZILMAZ.
  callId: z.string().optional(),
  detail: z.string().optional(),
});
export type PipelineData = z.infer<typeof PipelineData>;

export const SourceItem = z.object({
  ref: Ref,
  kind: z.enum(SOURCE_KINDS),
  sourceId: z.string(),
  shortKunye: z.string(),
  title: z.string(),
  origin: z.enum(['corpus', 'live', 'user']),
  portal: z.enum(SOURCE_CODES).optional(),
  /** Karar kaynağında mahkeme türü (P12 K4); arayüz kurum işaretini buradan seçer. */
  courtType: z.enum(COURT_TYPES).optional(),
  retrievedAt: z.iso.date(),
  /**
   * Kaynağın bu sohbet için portaldan getirildiği an (ISO 8601, saat dilimli). Sunucu çağrı anından
   * doldurur; arayüz Europe/Istanbul'da "erişim GG.AA.YYYY" yazar. Yoksa arayüz tarih uydurmaz.
   */
  fetchedAt: z.iso.datetime({ offset: true }).optional(),
  url: z.url().optional(),
  relevance: z.enum(['high', 'medium']),
  /**
   * Modelin gerçekten okuduğu kaynak metin (#58). Yoksa model yalnız künyeyi gördü ("Yalnız künye").
   * Sunucu doldurur; arayüz "atıftan pasaja" vurgusunu bu metin üzerinde hesaplar.
   */
  excerpt: z.string().max(12000).optional(),
});
export type SourceItem = z.infer<typeof SourceItem>;

export const SourcesData = z.object({ sources: z.array(SourceItem) });
export type SourcesData = z.infer<typeof SourcesData>;

export const CITATION_REASONS = [
  'not_in_conversation',
  'section_mismatch',
  'quote_mismatch',
  'anachronism',
  'not_in_coverage',
  'source_error',
] as const;

export const CitationItem = z.object({
  citationId: z.uuid(),
  ref: Ref.optional(),
  raw: z.string(),
  status: z.enum(KUNYE_STATUSES),
  sourceId: z.string().optional(),
  reason: z.enum(CITATION_REASONS).optional(),
  blocking: z.enum(['none', 'soft', 'hard']),
});
export type CitationItem = z.infer<typeof CitationItem>;

export const CitationsData = z.object({ final: z.boolean(), citations: z.array(CitationItem) });
export type CitationsData = z.infer<typeof CitationsData>;

export const DeadlineChecksData = z.object({
  checks: z.array(
    z.object({
      checkId: z.string(),
      text: z.string(),
      status: z.enum(['match', 'mismatch', 'no_calculation']),
      calculationId: z.string().optional(),
    }),
  ),
  calculations: z
    .array(
      z.object({
        calculationId: z.string(),
        ruleId: z.uuid(),
        ruleVersion: z.number().int(),
        ruleLabel: z.string(),
        startEvent: z.enum(['service', 'pronouncement', 'learning']),
        startDate: z.iso.date(),
        endDate: z.iso.date(),
        steps: z.array(z.string()),
        verifiedBy: z.string(),
        verifiedAt: z.iso.date(),
      }),
    )
    .optional(),
});

export const DocumentOutline = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  subtype: z.string().nullable(),
  court: z.string().nullable(),
  subject: z.string(),
  sections: z.array(
    z.object({
      role: z.enum(SECTION_ROLES),
      heading: z.string(),
      intent: z.string(),
      sourceRefs: z.array(Ref),
    }),
  ),
  questions: z.array(z.string()),
});

export const CanvasData = z.object({
  documentId: z.uuid(),
  op: z.enum(['open', 'outline', 'block', 'done', 'error']),
  kind: z.enum(DOCUMENT_KINDS).optional(),
  outline: DocumentOutline.optional(),
  block: z
    .object({
      blockId: z.string(),
      role: z.enum(SECTION_ROLES),
      rev: z.number().int(),
      content: z.array(z.unknown()),
    })
    .optional(),
  version: z.number().int().optional(),
});

export const SuggestionsData = z.object({
  documentId: z.uuid(),
  suggestionId: z.uuid(),
  baseVersion: z.number().int(),
  ops: z.array(
    z.object({
      opId: z.string(),
      type: z.enum(EDIT_OP_TYPES),
      blockId: z.string(),
      reason: z.string(),
      citationIds: z.array(z.uuid()),
    }),
  ),
});

export const UsageData = z.object({
  opCode: z.enum(CREDIT_OP_CODES),
  credits: z.number().int(),
  balanceAfter: z.number().int(),
  reservationId: z.uuid(),
  final: z.boolean(),
});

export const NoticeData = z.object({
  code: z.enum(NOTICE_CODES),
  level: z.enum(['info', 'warning', 'error']),
  message: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type NoticeData = z.infer<typeof NoticeData>;

export const dataPartSchemas = {
  pipeline: PipelineData,
  sources: SourcesData,
  citations: CitationsData,
  'deadline-checks': DeadlineChecksData,
  canvas: CanvasData,
  suggestions: SuggestionsData,
  usage: UsageData,
  notice: NoticeData,
} as const;

export type DataPartName = keyof typeof dataPartSchemas;
export const DATA_PART_NAMES = Object.keys(dataPartSchemas) as DataPartName[];

/** AI SDK UIMessage data tip haritası (istemci `useChat<EdaUIMessage>` ile kullanır). */
export type EdaDataParts = { [K in DataPartName]: z.infer<(typeof dataPartSchemas)[K]> };
