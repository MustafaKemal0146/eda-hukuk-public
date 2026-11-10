// @eda/contracts/mcp: yargi-mcp araç sözleşmeleri (021 §5.4–§5.6, §5.14). Sunucu ve istemci ortak kullanır.
import type { z } from 'zod';
import type { McpToolName } from './common.ts';
import {
  McpGetDecisionInput,
  McpGetDecisionOutput,
  McpSearchDecisionsInput,
  McpSearchDecisionsOutput,
} from './decisions.ts';
import {
  McpGetLegislationLiveInput,
  McpGetLegislationLiveOutput,
  McpSearchLegislationLiveInput,
  McpSearchLegislationLiveOutput,
} from './legislation.ts';
import { McpSourceStatusInput, McpSourceStatusOutput } from './source-status.ts';

export type McpToolSpec = {
  name: McpToolName;
  title: string;
  inputSchema: z.ZodObject;
  outputSchema: z.ZodType;
  annotations: {
    readOnlyHint: true;
    idempotentHint: true;
    destructiveHint: false;
    openWorldHint: boolean;
  };
};

const live = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: true,
} as const;

/** `tools/list` sırası ve açıklamaları (021 §5.4 tablosu); sıra MCP_TOOL_NAMES ile aynıdır. */
export const MCP_TOOLS = [
  {
    name: 'search_decisions',
    title: 'Karar arama (canlı)',
    inputSchema: McpSearchDecisionsInput,
    outputSchema: McpSearchDecisionsOutput,
    annotations: live,
  },
  {
    name: 'get_decision',
    title: 'Karar metni (canlı)',
    inputSchema: McpGetDecisionInput,
    outputSchema: McpGetDecisionOutput,
    annotations: live,
  },
  {
    name: 'search_legislation_live',
    title: 'Mevzuat arama (canlı)',
    inputSchema: McpSearchLegislationLiveInput,
    outputSchema: McpSearchLegislationLiveOutput,
    annotations: live,
  },
  {
    name: 'get_legislation_live',
    title: 'Madde metni (canlı)',
    inputSchema: McpGetLegislationLiveInput,
    outputSchema: McpGetLegislationLiveOutput,
    annotations: live,
  },
  {
    name: 'source_status',
    title: 'Kaynak durumu',
    inputSchema: McpSourceStatusInput,
    outputSchema: McpSourceStatusOutput,
    annotations: { ...live, openWorldHint: false },
  },
] as const satisfies readonly McpToolSpec[];

export {
  ChamberCode,
  DECISION_LIVE_SOURCES,
  DecisionLiveSource,
  type DecisionLiveSourceCode,
  FACET_KEYS,
  FacetKey,
  MCP_CACHE_SCOPES,
  MCP_ERROR_CODES,
  MCP_ERROR_REASONS,
  MCP_META_CACHE_SCOPE,
  MCP_META_PRIORITY,
  MCP_PRIORITIES,
  MCP_PROTOCOL_VERSION,
  MCP_TOOL_NAMES,
  type McpCacheScope,
  type McpErrorCode,
  type McpErrorReason,
  type McpPriority,
  McpToolError,
  type McpToolErrorBody,
  type McpToolName,
  NormalizedDecision,
  type NormalizedDecisionValue,
  SEARCH_WARNINGS,
} from './common.ts';
export {
  McpDecisionSection,
  type McpDecisionSectionValue,
  type McpGetDecisionArgs,
  McpGetDecisionInput,
  McpGetDecisionOutput,
  type McpGetDecisionResult,
  McpGetDecisionSuccess,
  type McpSearchDecisionsArgs,
  McpSearchDecisionsInput,
  McpSearchDecisionsOutput,
  type McpSearchDecisionsResult,
  McpSearchDecisionsSuccess,
} from './decisions.ts';
export {
  LegislationArticle,
  type LegislationArticleValue,
  LegislationHit,
  type LegislationHitValue,
  type McpGetLegislationLiveArgs,
  McpGetLegislationLiveInput,
  McpGetLegislationLiveOutput,
  type McpGetLegislationLiveResult,
  McpGetLegislationLiveSuccess,
  McpLawType,
  type McpSearchLegislationLiveArgs,
  McpSearchLegislationLiveInput,
  McpSearchLegislationLiveOutput,
  type McpSearchLegislationLiveResult,
  McpSearchLegislationLiveSuccess,
  MevzuatRef,
} from './legislation.ts';
export {
  McpSourceStatusInput,
  McpSourceStatusOutput,
  type McpSourceStatusResult,
  SourceStatusEntry,
  type SourceStatusEntryValue,
} from './source-status.ts';
export {
  PUBLISHED_SOURCE_CONFIG_PREFIXES,
  PublishedSourcesConfig,
  type PublishedSourcesConfigValue,
  VALKEY_CACHE_KEYS,
} from './valkey.ts';
