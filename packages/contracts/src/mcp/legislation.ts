// search_legislation_live / get_legislation_live MCP şemaları (021 §5.4).
import { z } from 'zod';
import { MCP_LAW_TYPES } from '../enums.ts';
import { IsoDate, LawNo } from '../tools/common.ts';
import { McpToolError } from './common.ts';

export const McpLawType = z.enum(MCP_LAW_TYPES);
/** `<MevzuatTur>.<MevzuatTertip>.<MevzuatNo>` (021 §5.6), ör. TBK `1.5.6098`. */
export const MevzuatRef = z.string().regex(/^\d{1,2}\.\d{1,2}\.\d{1,12}$/);

export const McpSearchLegislationLiveInput = z
  .object({
    query: z.string().min(2).max(200),
    law_no: LawNo.nullable(),
    page: z.number().int().min(1).max(20),
    page_size: z.number().int().min(1).max(10),
  })
  .strict();
export type McpSearchLegislationLiveArgs = z.infer<typeof McpSearchLegislationLiveInput>;

export const LegislationHit = z
  .object({
    source: z.literal('mevzuat'),
    // Yönetmelik/tebliğ numaraları LawNo'dan (≤ 5 hane) uzun olabilir; çıktıda serbest sayı dizesi.
    law_no: z.string().regex(/^\d{1,12}$/),
    law_type: McpLawType,
    law_name: z.string(),
    mevzuat_ref: MevzuatRef,
    article_no: z.string().nullable(),
    title: z.string(),
    snippet: z.string().max(300).nullable(),
    url: z.string().url(),
    last_amended_at: IsoDate.nullable(),
    retrieved_at: IsoDate,
  })
  .strict();
export type LegislationHitValue = z.infer<typeof LegislationHit>;

export const McpSearchLegislationLiveSuccess = z
  .object({
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int().nullable(),
    has_more: z.boolean().nullable(),
    results: z.array(LegislationHit).max(10),
    status: z.enum(['ok', 'stale']),
    cached: z.boolean(),
    stale_as_of: IsoDate.nullable(),
    warnings: z.array(z.enum(['results_truncated'])),
  })
  .strict();
export type McpSearchLegislationLiveResult = z.infer<typeof McpSearchLegislationLiveSuccess>;
export const McpSearchLegislationLiveOutput = z.union([
  McpSearchLegislationLiveSuccess,
  McpToolError,
]);

export const McpGetLegislationLiveInput = z
  .object({
    law_no: LawNo,
    law_type: McpLawType.nullable(),
    article_no: z.string().min(1).max(20),
    article_to: z.string().min(1).max(20).nullable(),
  })
  .strict();
export type McpGetLegislationLiveArgs = z.infer<typeof McpGetLegislationLiveInput>;

export const LegislationArticle = z
  .object({
    article_no: z.string(),
    heading: z.string().nullable(),
    markdown: z.string(),
    repealed: z.boolean(),
  })
  .strict();
export type LegislationArticleValue = z.infer<typeof LegislationArticle>;

export const McpGetLegislationLiveSuccess = z
  .object({
    law_no: z.string(),
    law_type: McpLawType,
    law_name: z.string(),
    mevzuat_ref: MevzuatRef,
    url: z.string().url(),
    retrieved_at: IsoDate,
    last_amended_at: IsoDate.nullable(),
    articles: z.array(LegislationArticle).max(5),
    total_chars: z.number().int(),
    cached: z.boolean(),
    warnings: z.array(z.enum(['article_range_truncated', 'article_not_found'])),
  })
  .strict();
export type McpGetLegislationLiveResult = z.infer<typeof McpGetLegislationLiveSuccess>;
export const McpGetLegislationLiveOutput = z.union([McpGetLegislationLiveSuccess, McpToolError]);
