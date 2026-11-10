// Kaynak hatası: araç sonucunda McpToolError gövdesine dönüşür (021 §5.4). Mesajda içerik yok.
import type { SourceCode } from '@eda/contracts/enums';
import type { McpErrorCode, McpErrorReason, McpToolErrorBody } from '@eda/contracts/mcp';

export class SourceError extends Error {
  readonly code: McpErrorCode;
  readonly reason: McpErrorReason | null;
  readonly retryAfterMs: number | null;
  readonly source: SourceCode | null;

  constructor(
    code: McpErrorCode,
    reason: McpErrorReason | null,
    opts: { retryAfterMs?: number | null; source?: SourceCode | null } = {},
  ) {
    super(`${code}${reason ? `/${reason}` : ''}`);
    this.name = 'SourceError';
    this.code = code;
    this.reason = reason;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.source = opts.source ?? null;
  }
}

export function toToolError(err: SourceError): McpToolErrorBody {
  return {
    error: {
      code: err.code,
      reason: err.reason,
      retry_after_ms: err.retryAfterMs,
      source: err.source,
    },
  };
}

export const validationFailed = (
  reason: 'invalid_document_id' | 'invalid_arguments',
  source: SourceCode | null,
): SourceError => new SourceError('VALIDATION_FAILED', reason, { source });
