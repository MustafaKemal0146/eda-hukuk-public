// Karar Arşivi ve Mevzuat uçlarının canlı kaynak bağdaştırıcısı (021 §6). Sohbet arka ucuyla aynı
// yargi-mcp istemcisini ve SOURCE_BUSY sınırlı yeniden denemesini kullanır; ondan farkı
// hatayı kaynak, gerekçe ve bekleme süresiyle birlikte taşımasıdır (HTTP 503 + Retry-After için).
import { SourceError } from '@eda/ai';
import {
  getDecisionLive,
  getLegislationLive,
  type McpResult,
  searchDecisionsLive,
  searchLegislationLive,
} from '@eda/ai/mcp';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type {
  McpErrorCode,
  McpErrorReason,
  McpGetDecisionArgs,
  McpGetDecisionResult,
  McpGetLegislationLiveArgs,
  McpGetLegislationLiveResult,
  McpSearchDecisionsArgs,
  McpSearchDecisionsResult,
  McpSearchLegislationLiveArgs,
  McpSearchLegislationLiveResult,
} from '@eda/contracts/mcp';
import { abortableSleep, type Sleep, withBusyRetry } from '../../chat/mcp-backend.ts';
import type { McpClientProvider } from '../../clients/yargi-mcp.ts';

export class LiveSourceError extends Error {
  override name = 'LiveSourceError';
  readonly code: McpErrorCode;
  readonly reason: McpErrorReason | null;
  readonly retryAfterMs: number | null;
  readonly source: string | null;
  constructor(
    code: McpErrorCode,
    reason: McpErrorReason | null = null,
    retryAfterMs: number | null = null,
    source: string | null = null,
  ) {
    super(code);
    this.code = code;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
    this.source = source;
  }
}

export type LiveSource = {
  searchDecisions(
    args: McpSearchDecisionsArgs,
    signal: AbortSignal,
  ): Promise<McpSearchDecisionsResult>;
  getDecision(args: McpGetDecisionArgs, signal: AbortSignal): Promise<McpGetDecisionResult>;
  searchLegislation(
    args: McpSearchLegislationLiveArgs,
    signal: AbortSignal,
  ): Promise<McpSearchLegislationLiveResult>;
  getLegislation(
    args: McpGetLegislationLiveArgs,
    signal: AbortSignal,
  ): Promise<McpGetLegislationLiveResult>;
};

function unwrap<T>(res: McpResult<T>): T {
  if (res.ok) return res.value;
  const e = res.error;
  throw new LiveSourceError(e.code, e.reason, e.retry_after_ms, e.source);
}

/** Etkileşimli öncelik (kullanıcı eylemi; 021 §5.10). Kova sınırları yargi-mcp'dedir. */
const opts = (signal: AbortSignal) => ({ priority: 'interactive' as const, signal });

export function createMcpLiveSource(
  provider: McpClientProvider,
  sleep: Sleep = abortableSleep,
): LiveSource {
  async function client() {
    try {
      return await provider();
    } catch (err) {
      if (err instanceof SourceError) throw new LiveSourceError('SOURCE_UNAVAILABLE', 'network');
      throw err;
    }
  }
  return {
    async searchDecisions(args, signal) {
      const c = await client();
      // Uyuşmazlık tam metin araması portalda uzun sürer; api→yargi-mcp süresi ayrı anahtar.
      const o =
        args.source === 'uyusmazlik'
          ? { ...opts(signal), timeoutMs: CONFIG_DEFAULTS['sources.mcpSlowSearchTimeoutMs'] }
          : opts(signal);
      return unwrap(await withBusyRetry(() => searchDecisionsLive(c, args, o), signal, sleep));
    },
    async getDecision(args, signal) {
      const c = await client();
      return unwrap(
        await withBusyRetry(() => getDecisionLive(c, args, opts(signal)), signal, sleep),
      );
    },
    async searchLegislation(args, signal) {
      const c = await client();
      return unwrap(
        await withBusyRetry(() => searchLegislationLive(c, args, opts(signal)), signal, sleep),
      );
    },
    async getLegislation(args, signal) {
      const c = await client();
      return unwrap(
        await withBusyRetry(() => getLegislationLive(c, args, opts(signal)), signal, sleep),
      );
    },
  };
}
