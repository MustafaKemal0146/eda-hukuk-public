// MCP çağrı sonucu ve hata eşlemesi (021 §6.4). Sarmalayıcılar fırlatmaz; tipli sonuç döndürür.
import type { McpErrorCode, McpErrorReason, McpToolErrorBody } from '@eda/contracts/mcp';

export type McpCallError = McpToolErrorBody['error'] & {
  /** İstemci tarafı köken: araç hatası mı, taşıma/protokol mü, çıktı şeması mı. */
  origin: 'tool' | 'transport' | 'output_invalid' | 'input_rejected';
};

export type McpResult<T> = { ok: true; value: T } | { ok: false; error: McpCallError };

export const transportError = (reason: McpErrorReason): McpCallError => ({
  code: 'SOURCE_UNAVAILABLE',
  reason,
  retry_after_ms: null,
  source: null,
  origin: 'transport',
});

/** 021 §6.4 tablosu: sohbet aracı / Karar Arşivi / worker davranışını seçmek için. */
export type McpErrorAction =
  | 'local_with_notice'
  | 'not_in_coverage'
  | 'not_found'
  | 'pii_blocked'
  | 'internal';

export function errorAction(code: McpErrorCode): McpErrorAction {
  switch (code) {
    case 'SOURCE_BUSY':
    case 'SOURCE_RATE_LIMITED':
    case 'SOURCE_UNAVAILABLE':
      return 'local_with_notice';
    case 'SOURCE_NOT_IN_COVERAGE':
      return 'not_in_coverage';
    case 'SOURCE_DOCUMENT_NOT_FOUND':
      return 'not_found';
    case 'SOURCE_PII_BLOCKED':
      return 'pii_blocked';
    case 'VALIDATION_FAILED':
      return 'internal';
  }
}

/** Worker: yeniden denenebilir mi (VALIDATION_FAILED/NOT_FOUND/PII/kapsam dışı kalıcıdır). */
export function isRetryable(err: McpCallError): boolean {
  return errorAction(err.code) === 'local_with_notice';
}
