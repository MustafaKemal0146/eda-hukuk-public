// Canlı arama durum matrisi (053-04 §4.6): api hata kodu / kaynak durumu → katalog anahtarı. Kaynağa
// ulaşılamaması ve kapsam dışı kaynak hiçbir zaman "sonuç yok" olarak gösterilmez.
import type { LiveSourceStateValue, SearchResultsDtoValue } from '@eda/contracts/api';

export type LiveErrorKey =
  | 'busy'
  | 'rateLimited'
  | 'unavailable'
  | 'pii'
  | 'notInCoverage'
  | 'expired'
  | 'network'
  | 'generic';

export function liveErrorKey(code: string): LiveErrorKey {
  switch (code) {
    case 'SOURCE_BUSY':
      return 'busy';
    case 'SOURCE_RATE_LIMITED':
      return 'rateLimited';
    case 'SOURCE_UNAVAILABLE':
      return 'unavailable';
    case 'SOURCE_PII_BLOCKED':
      return 'pii';
    case 'SOURCE_NOT_IN_COVERAGE':
      return 'notInCoverage';
    case 'VALIDATION_RESOURCE_NOT_FOUND':
      return 'expired';
    case 'CLIENT_NETWORK':
      return 'network';
    default:
      return 'generic';
  }
}

/** Kaynak satırı anahtarı: `done`/`stale` sayı ile, diğerleri durum metniyle. */
export function sourceStatusKey(
  s: LiveSourceStateValue,
): 'done' | 'stale' | 'notInCoverage' | 'busy' | 'unavailable' {
  switch (s.status) {
    case 'done':
    case 'stale':
      return s.status;
    case 'not_in_coverage':
      return 'notInCoverage';
    case 'busy':
    case 'rate_limited':
      return 'busy';
    case 'unavailable':
      return 'unavailable';
  }
}

export type LiveBanner =
  | { kind: 'none' }
  | { kind: 'cta'; primary: boolean }
  | { kind: 'blocked_pii' }
  | { kind: 'done' };

/** Banner biçimi: canlı otomatik başlamaz; yerel korpus yokken düğme birincildir. */
export function liveBannerOf(dto: SearchResultsDtoValue): LiveBanner {
  if (!dto.live.available) return { kind: 'none' };
  if (dto.live.status === 'blocked_pii') return { kind: 'blocked_pii' };
  if (dto.live.requested) return { kind: 'done' };
  return { kind: 'cta', primary: dto.liveReasons.length > 0 || !dto.localCorpus.available };
}
