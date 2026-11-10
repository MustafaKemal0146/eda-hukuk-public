// search_decisions / get_decision MCP şemaları (021 §5.4).
import { z } from 'zod';
import { CourtTypeSchema, DecisionSectionRole, EsasNo, IsoDate } from '../tools/common.ts';
import {
  ChamberCode,
  DecisionLiveSource,
  McpToolError,
  NormalizedDecision,
  SEARCH_WARNINGS,
} from './common.ts';

export const McpSearchDecisionsInput = z
  .object({
    source: DecisionLiveSource,
    query: z.string().min(2).max(300),
    court_types: z.array(CourtTypeSchema).min(1).max(8).nullable(),
    chamber: ChamberCode.nullable(),
    date_from: IsoDate.nullable(),
    date_to: IsoDate.nullable(),
    esas_no: EsasNo.nullable(),
    karar_no: EsasNo.nullable(),
    page: z.number().int().min(1).max(50),
    page_size: z.number().int().min(1).max(10),
  })
  .strict();
export type McpSearchDecisionsArgs = z.infer<typeof McpSearchDecisionsInput>;

export const McpSearchDecisionsSuccess = z
  .object({
    source: DecisionLiveSource,
    page: z.number().int(),
    page_size: z.number().int(),
    total: z.number().int().nullable(),
    has_more: z.boolean().nullable(),
    results: z.array(NormalizedDecision).max(10),
    status: z.enum(['ok', 'stale']),
    cached: z.boolean(),
    stale_as_of: IsoDate.nullable(),
    warnings: z.array(z.enum(SEARCH_WARNINGS)),
  })
  .strict();
export type McpSearchDecisionsResult = z.infer<typeof McpSearchDecisionsSuccess>;
export const McpSearchDecisionsOutput = z.union([McpSearchDecisionsSuccess, McpToolError]);

export const McpGetDecisionInput = z
  .object({
    source: DecisionLiveSource,
    document_id: z.string().max(200),
    section: z.number().int().min(1).nullable(),
  })
  .strict();
export type McpGetDecisionArgs = z.infer<typeof McpGetDecisionInput>;

export const McpDecisionSection = z
  .object({
    no: z.number().int(),
    role: DecisionSectionRole,
    chars: z.number().int(),
    markdown: z.string().nullable(),
  })
  .strict();
export type McpDecisionSectionValue = z.infer<typeof McpDecisionSection>;

export const McpGetDecisionSuccess = z
  .object({
    source: DecisionLiveSource,
    document_id: z.string(),
    court_type: CourtTypeSchema,
    court: z.string().nullable(),
    chamber: z.string().nullable(),
    chamber_code: ChamberCode.nullable(),
    esas_no: z.string().nullable(),
    karar_no: z.string().nullable(),
    decision_date: IsoDate.nullable(),
    title: z.string().nullable(),
    url: z.string().url(),
    retrieved_at: IsoDate,
    mime_type: z.enum(['text/html', 'application/pdf']),
    text_status: z.enum(['ok', 'text_unavailable']),
    total_sections: z.number().int(),
    total_chars: z.number().int(),
    content_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    sections: z.array(McpDecisionSection),
    cached: z.boolean(),
    warnings: z.array(z.enum(['truncated_max_chars', 'metadata_partial'])),
  })
  .strict();
export type McpGetDecisionResult = z.infer<typeof McpGetDecisionSuccess>;
export const McpGetDecisionOutput = z.union([McpGetDecisionSuccess, McpToolError]);
