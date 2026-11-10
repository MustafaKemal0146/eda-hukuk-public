// MCP sunucu fabrikası (021 §5.1): her HTTP isteğinde YENİ McpServer; yalnız `tools` yeteneği
// (listChanged: false); araçlar MCP_TOOLS sırasıyla; `tools/list` ttlMs 3600000, cacheScope public.
import {
  MCP_CACHE_SCOPES,
  MCP_META_CACHE_SCOPE,
  MCP_META_PRIORITY,
  MCP_PRIORITIES,
  MCP_TOOLS,
  type McpCacheScope,
  type McpPriority,
  type McpToolName,
} from '@eda/contracts/mcp';
import type { EdaLogger } from '@eda/observability/logger';
import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import { queryHash } from './resilience/cache.ts';
import { SourceError, toToolError } from './sources/errors.ts';
import type { CallCtx, ToolDeps } from './tools/context.ts';
import { getDecision } from './tools/get-decision.ts';
import { getLegislationLive, searchLegislationLive } from './tools/legislation.ts';
import { searchDecisions } from './tools/search-decisions.ts';
import { sourceStatus } from './tools/source-status.ts';

/** 021 §5.1 / P11 K7. */
export const MAX_TOOL_INPUT_ELEMENTS = 20;
const TOOLS_LIST_TTL_MS = 3_600_000;

type Handler = (deps: ToolDeps, args: never, ctx: CallCtx) => Promise<object> | object;

const HANDLERS: Record<McpToolName, Handler> = {
  search_decisions: searchDecisions,
  get_decision: getDecision,
  search_legislation_live: searchLegislationLive,
  get_legislation_live: getLegislationLive,
  source_status: (deps: ToolDeps) => sourceStatus(deps),
};

function pick<T extends string>(allowed: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function logFields(args: Record<string, unknown>): Record<string, unknown> {
  const q = typeof args.query === 'string' ? args.query : null;
  return {
    source: typeof args.source === 'string' ? args.source : null,
    ...(q === null ? {} : { query_hash: queryHash(q), query_len: q.length }),
  };
}

export function createMcpServer(deps: ToolDeps, org: string, logger: EdaLogger): McpServer {
  const server = new McpServer(
    { name: 'yargi-mcp', version: pkg.version },
    {
      capabilities: { tools: { listChanged: false } },
      maxToolInputElements: MAX_TOOL_INPUT_ELEMENTS,
      cacheHints: { 'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'public' } },
    },
  );
  for (const spec of MCP_TOOLS) {
    const handler = HANDLERS[spec.name];
    server.registerTool(
      spec.name,
      {
        title: spec.title,
        inputSchema: spec.inputSchema,
        outputSchema: spec.outputSchema,
        annotations: { title: spec.title, ...spec.annotations },
      },
      async (args: Record<string, unknown>, ctx: ServerContext) => {
        const meta = ctx.mcpReq._meta ?? {};
        let priority = pick<McpPriority>(MCP_PRIORITIES, meta[MCP_META_PRIORITY]);
        if (priority === null) {
          // P11 K9: sınıfsız istek en kısıtlı sınıf `ingest` sayılır.
          logger.warn({
            event: 'config.setting_invalid',
            tool: spec.name,
            reason: 'mcp_priority_missing',
          });
          priority = 'ingest';
        }
        const cacheScope =
          pick<McpCacheScope>(MCP_CACHE_SCOPES, meta[MCP_META_CACHE_SCOPE]) ?? 'shared';
        const call: CallCtx = { org, priority, cacheScope };
        const started = deps.now();
        const base = { tool: spec.name, org, priority, ...logFields(args) };
        try {
          const out = await handler(deps, args as never, call);
          const cached = 'cached' in out ? Boolean(out.cached) : false;
          logger.info({
            event: 'http.request.completed',
            ...base,
            status: 'ok',
            cache: cached ? 'hit' : 'miss',
            duration_ms: deps.now() - started,
          });
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(out) }],
            structuredContent: out as Record<string, unknown>,
          };
        } catch (err) {
          const e =
            err instanceof SourceError ? err : new SourceError('SOURCE_UNAVAILABLE', 'network');
          if (!(err instanceof SourceError)) {
            logger.error({ event: 'dependency.degraded', ...base, err_name: (err as Error)?.name });
          }
          logger.info({
            event: 'http.request.completed',
            ...base,
            status: e.code,
            reason: e.reason,
            duration_ms: deps.now() - started,
          });
          const body = toToolError(e);
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(body) }],
            structuredContent: body as unknown as Record<string, unknown>,
            isError: true,
          };
        }
      },
    );
  }
  return server;
}
