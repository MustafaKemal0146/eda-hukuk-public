// Arama sonucu bellek önbelleği (053-04 §3.6 `setQueryData` karşılığı): POST yanıtı SERP'e ikinci GET
// olmadan taşınır. KALICI DEĞİL (localStorage/sessionStorage YOK; 050 §9.3); anahtarda sorgu yoktur.
import type { SearchResultsDtoValue, SearchSort } from '@eda/contracts/api';

const MAX = 20;
const cache = new Map<string, SearchResultsDtoValue>();

const keyOf = (searchId: string, page: number, sort: SearchSort) => `${searchId}|${page}|${sort}`;

export function rememberResults(dto: SearchResultsDtoValue): void {
  const key = keyOf(dto.searchId, dto.pagination.page, dto.sort);
  cache.delete(key);
  cache.set(key, dto);
  while (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function cachedResults(
  searchId: string,
  page: number,
  sort: SearchSort,
): SearchResultsDtoValue | undefined {
  return cache.get(keyOf(searchId, page, sort));
}

/** Canlı sonuç eklenince eski sayfalar geçersizdir. */
export function forgetSearch(searchId: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${searchId}|`)) cache.delete(key);
}
