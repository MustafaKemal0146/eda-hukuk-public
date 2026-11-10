// Mevzuat ekranı hata metni seçimi (053-05 §5.5): kaynak hatası hiçbir zaman "bulunamadı" değildir.
import type { SourceErrorInfo } from '../../lib/research-api.ts';

export type LegislationErrorKey =
  | 'busy'
  | 'rateLimited'
  | 'unavailable'
  | 'network'
  | 'validation'
  | 'notFound'
  | 'generic';

export function legislationErrorKey(info: SourceErrorInfo): LegislationErrorKey {
  switch (info.code) {
    case 'SOURCE_BUSY':
      return 'busy';
    case 'SOURCE_RATE_LIMITED':
      return 'rateLimited';
    case 'SOURCE_UNAVAILABLE':
    case 'SOURCE_NOT_IN_COVERAGE':
      return 'unavailable';
    case 'CLIENT_NETWORK':
      return 'network';
    case 'VALIDATION_FAILED':
      return 'validation';
    case 'VALIDATION_RESOURCE_NOT_FOUND':
    case 'SOURCE_DOCUMENT_NOT_FOUND':
      return 'notFound';
    default:
      return 'generic';
  }
}
