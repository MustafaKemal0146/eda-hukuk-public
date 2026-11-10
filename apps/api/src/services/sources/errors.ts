// Canlı kaynak hatası → 044 zarfı (021 §6.4): SOURCE_BUSY 503 + Retry-After, SOURCE_RATE_LIMITED 429,
// SOURCE_UNAVAILABLE 503, SOURCE_NOT_IN_COVERAGE 422, SOURCE_PII_BLOCKED 422. Kaynağa ulaşılamaması hiçbir
// zaman "bulunamadı"ya çevrilmez; yalnız SOURCE_DOCUMENT_NOT_FOUND 404'tür.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { McpErrorReason } from '@eda/contracts/mcp';
import type { LiveSourceError } from './live-source.ts';

const DEFAULT_RETRY_SEC = CONFIG_DEFAULTS['sources.retryAfterDefaultSec'];
const MAX_RETRY_SEC = CONFIG_DEFAULTS['sources.retryAfterMaxSec'];

/** Bekleme (ms) → Retry-After saniyesi: yukarı yuvarlanır, [1, retryAfterMaxSec] aralığında. */
export function retryAfterSec(ms: number | null): number {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return DEFAULT_RETRY_SEC;
  return Math.min(MAX_RETRY_SEC, Math.max(1, Math.ceil(ms / 1000)));
}

function unavailableReason(
  r: McpErrorReason | null,
): 'breaker_open' | 'timeout' | 'upstream_error' | 'cache_unavailable' | null {
  switch (r) {
    case 'breaker_open':
    case 'timeout':
      return r;
    case 'limiter_unavailable':
      return 'cache_unavailable';
    case null:
    case 'source_disabled':
    case 'invalid_document_id':
    case 'invalid_arguments':
    case 'queue_wait_exceeded':
      return null;
    default:
      return 'upstream_error';
  }
}

/** Kaynak meta değeri yalnız kısa kod (`bedesten`, `mevzuat` …); içerik taşımaz. */
function sourceMeta(s: string | null): string | null {
  return s !== null && /^[a-z_]{1,32}$/.test(s) ? s : null;
}

/**
 * `notFound`: belge yok yanıtının hangi 404'e dönüşeceği (karar → SOURCE_DOCUMENT_NOT_FOUND;
 * mevzuat → VALIDATION_RESOURCE_NOT_FOUND `law`/`article`, 053-05 §5.5).
 */
export function liveErrorToAppError(
  err: LiveSourceError,
  notFound: 'source_document' | 'law' | 'article' | 'decision' = 'source_document',
): AppError {
  const source = sourceMeta(err.source);
  switch (err.code) {
    case 'SOURCE_BUSY':
      return new AppError('SOURCE_BUSY', {
        reason:
          err.reason === 'breaker_open' || err.reason === 'queue_wait_exceeded' ? err.reason : null,
        meta: { source, retryAfterSec: retryAfterSec(err.retryAfterMs) },
      });
    case 'SOURCE_RATE_LIMITED':
      return new AppError('SOURCE_RATE_LIMITED', {
        meta: { source, retryAfterSec: retryAfterSec(err.retryAfterMs) },
      });
    case 'SOURCE_NOT_IN_COVERAGE':
      return new AppError('SOURCE_NOT_IN_COVERAGE', { actions: ['open_portal'], meta: { source } });
    case 'SOURCE_PII_BLOCKED':
      return new AppError('SOURCE_PII_BLOCKED', {
        reason: 'pii_detected',
        actions: ['remove_personal_data'],
        meta: { source },
      });
    case 'SOURCE_DOCUMENT_NOT_FOUND':
      if (notFound === 'source_document') {
        return new AppError('SOURCE_DOCUMENT_NOT_FOUND', { meta: { source } });
      }
      return new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: notFound });
    case 'VALIDATION_FAILED':
      // Geçersiz belge kimliği/argüman: kullanıcıya kaynak hatası değil, kayıt yok olarak döner.
      if (notFound !== 'source_document') {
        return new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: notFound });
      }
      return new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'decision' });
    case 'SOURCE_UNAVAILABLE':
      return new AppError('SOURCE_UNAVAILABLE', {
        reason: unavailableReason(err.reason),
        actions: ['open_portal'],
        meta: { source, retryAfterSec: retryAfterSec(err.retryAfterMs) },
      });
  }
}
