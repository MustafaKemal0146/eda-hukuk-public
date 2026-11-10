// Karar Arşivi URL durumu (053-04 §1; 050 §9.2): yalnız `sayfa`, `siralama`, `bolum`. Serbest metin,
// sorgu ve süzgeç URL'de taşınmaz (süzgeç değişimi yeni `searchId` üretir). nuqs bağımlılığı yokken
// `useSearchParams` ile okunur.
import { ARCHIVE_MAX_PAGES, type SearchSort } from '@eda/contracts/api';

export const SORT_PARAM = { alaka: 'relevance', yeni: 'date_desc', eski: 'date_asc' } as const;
export type SortParam = keyof typeof SORT_PARAM;

type Params = { get(name: string): string | null };

export function pageFromParams(p: Params): number {
  const raw = p.get('sayfa');
  if (raw === null || !/^[1-9][0-9]{0,2}$/.test(raw)) return 1;
  return Math.min(Number(raw), ARCHIVE_MAX_PAGES);
}

export function sortFromParams(p: Params): SearchSort {
  const raw = p.get('siralama');
  return raw !== null && raw in SORT_PARAM ? SORT_PARAM[raw as SortParam] : 'relevance';
}

export function sortParamOf(sort: SearchSort): SortParam {
  const hit = (Object.keys(SORT_PARAM) as SortParam[]).find((k) => SORT_PARAM[k] === sort);
  return hit ?? 'alaka';
}

/** SERP adresi: varsayılan değerler yazılmaz. */
export function serpHref(searchId: string, page: number, sort: SearchSort): string {
  const p = new URLSearchParams();
  if (page > 1) p.set('sayfa', String(page));
  if (sort !== 'relevance') p.set('siralama', sortParamOf(sort));
  const q = p.toString();
  return `/karar-arsivi/ara/${encodeURIComponent(searchId)}${q === '' ? '' : `?${q}`}`;
}

export function sectionFromParams(p: Params): number | null {
  const raw = p.get('bolum');
  return raw !== null && /^[1-9][0-9]{0,3}$/.test(raw) ? Number(raw) : null;
}

export function decisionHref(decisionId: string): string {
  return `/karar-arsivi/karar/${encodeURIComponent(decisionId)}`;
}
