// Tipli yargi-mcp sarmalayıcıları (021 §6.1): girdi ve çıktı @eda/contracts/mcp ile doğrulanır; fırlatmaz.
// Zaman aşımları sources.mcpSearchTimeoutMs (20 sn) / sources.mcpDocTimeoutMs (30 sn).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  type McpCacheScope,
  type McpGetDecisionArgs,
  McpGetDecisionInput,
  type McpGetDecisionResult,
  McpGetDecisionSuccess,
  type McpGetLegislationLiveArgs,
  McpGetLegislationLiveInput,
  type McpGetLegislationLiveResult,
  McpGetLegislationLiveSuccess,
  type McpPriority,
  type McpSearchDecisionsArgs,
  McpSearchDecisionsInput,
  type McpSearchDecisionsResult,
  McpSearchDecisionsSuccess,
  type McpSearchLegislationLiveArgs,
  McpSearchLegislationLiveInput,
  type McpSearchLegislationLiveResult,
  McpSearchLegislationLiveSuccess,
  McpSourceStatusInput,
  McpSourceStatusOutput,
  type McpSourceStatusResult,
  type McpToolName,
} from '@eda/contracts/mcp';
import type { z } from 'zod';
import type { YargiMcpClient } from './client.ts';
import { type McpResult, transportError } from './errors.ts';

export type CallOptions = {
  priority: McpPriority;
  org?: string;
  cacheScope?: McpCacheScope;
  traceparent?: string;
  signal?: AbortSignal;
  /** Varsayılanı aşmak için (ms). */
  timeoutMs?: number;
};

const SEARCH_TIMEOUT_MS = CONFIG_DEFAULTS['sources.mcpSearchTimeoutMs'];
const DOC_TIMEOUT_MS = CONFIG_DEFAULTS['sources.mcpDocTimeoutMs'];

async function invoke<I extends z.ZodType, O extends z.ZodType>(
  client: YargiMcpClient,
  name: McpToolName,
  input: I,
  output: O,
  args: z.input<I>,
  opts: CallOptions,
  defaultTimeoutMs: number,
): Promise<McpResult<z.output<O>>> {
  const parsedIn = input.safeParse(args);
  if (!parsedIn.success) {
    return {
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        reason: 'invalid_arguments',
        retry_after_ms: null,
        source: null,
        origin: 'input_rejected',
      },
    };
  }
  const res = await client.callTool(name, parsedIn.data as Record<string, unknown>, {
    priority: opts.priority,
    timeoutMs: opts.timeoutMs ?? defaultTimeoutMs,
    ...(opts.org ? { org: opts.org } : {}),
    ...(opts.cacheScope ? { cacheScope: opts.cacheScope } : {}),
    ...(opts.traceparent ? { traceparent: opts.traceparent } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) return res;
  const parsedOut = output.safeParse(res.value);
  if (!parsedOut.success) {
    // 021 §6.4: outputSchema uyuşmazlığı → SOURCE_UNAVAILABLE (+ mcp.output_invalid log çağıranda).
    return { ok: false, error: { ...transportError('parse_error'), origin: 'output_invalid' } };
  }
  return { ok: true, value: parsedOut.data };
}

export function searchDecisionsLive(
  client: YargiMcpClient,
  args: McpSearchDecisionsArgs,
  opts: CallOptions,
): Promise<McpResult<McpSearchDecisionsResult>> {
  return invoke(
    client,
    'search_decisions',
    McpSearchDecisionsInput,
    McpSearchDecisionsSuccess,
    args,
    opts,
    SEARCH_TIMEOUT_MS,
  );
}

export function getDecisionLive(
  client: YargiMcpClient,
  args: McpGetDecisionArgs,
  opts: CallOptions,
): Promise<McpResult<McpGetDecisionResult>> {
  return invoke(
    client,
    'get_decision',
    McpGetDecisionInput,
    McpGetDecisionSuccess,
    args,
    opts,
    DOC_TIMEOUT_MS,
  );
}

export function searchLegislationLive(
  client: YargiMcpClient,
  args: McpSearchLegislationLiveArgs,
  opts: CallOptions,
): Promise<McpResult<McpSearchLegislationLiveResult>> {
  return invoke(
    client,
    'search_legislation_live',
    McpSearchLegislationLiveInput,
    McpSearchLegislationLiveSuccess,
    args,
    opts,
    SEARCH_TIMEOUT_MS,
  );
}

export function getLegislationLive(
  client: YargiMcpClient,
  args: McpGetLegislationLiveArgs,
  opts: CallOptions,
): Promise<McpResult<McpGetLegislationLiveResult>> {
  return invoke(
    client,
    'get_legislation_live',
    McpGetLegislationLiveInput,
    McpGetLegislationLiveSuccess,
    args,
    opts,
    DOC_TIMEOUT_MS,
  );
}

export function sourceStatus(
  client: YargiMcpClient,
  opts: CallOptions,
): Promise<McpResult<McpSourceStatusResult>> {
  return invoke(
    client,
    'source_status',
    McpSourceStatusInput,
    McpSourceStatusOutput,
    {},
    opts,
    SEARCH_TIMEOUT_MS,
  );
}
