// source_status MCP şeması (021 §5.14).
import { z } from 'zod';
import { SourceCode } from '../tools/common.ts';

export const McpSourceStatusInput = z.object({}).strict();

export const SourceStatusEntry = z
  .object({
    source: SourceCode,
    enabled: z.boolean(),
    state: z.enum(['up', 'degraded', 'down', 'disabled']),
    breaker: z.enum(['closed', 'open', 'half_open']),
    breaker_open_until: z.string().datetime().nullable(),
    last_success_at: z.string().datetime().nullable(),
    last_failure_at: z.string().datetime().nullable(),
    last_error_reason: z.string().nullable(),
    bucket_fill_pct: z.number().int().min(0).max(100),
    waiting: z
      .object({
        interactive: z.number().int(),
        verify: z.number().int(),
        ingest: z.number().int(),
      })
      .strict(),
    counters_1h: z
      .object({
        requests: z.number().int(),
        errors: z.number().int(),
        rate_limited: z.number().int(),
        cache_hits: z.number().int(),
        p95_ms: z.number().int().nullable(),
      })
      .strict(),
    last_canary: z.object({ at: z.string().datetime(), ok: z.boolean() }).strict().nullable(),
  })
  .strict();
export type SourceStatusEntryValue = z.infer<typeof SourceStatusEntry>;

export const McpSourceStatusOutput = z
  .object({
    generated_at: z.string().datetime(),
    sources: z.array(SourceStatusEntry),
  })
  .strict();
export type McpSourceStatusResult = z.infer<typeof McpSourceStatusOutput>;
