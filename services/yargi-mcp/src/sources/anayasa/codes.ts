// AYM karar türleri (021 §5.6, §5.7.2). : portal 2026'da tek sayfalı uygulamaya (`/kbb/`) geçti;
// iki alan adı aynı JSON arka ucunu (`/api/core/public/search`) kullanır ve kararı `kararTipi` ayırır.
// Eski kalıcı bağlantılar (`/ND/<karar no>`, `/BB/<başvuru no>`) portalın kendi çözümleyicisiyle açılır
// (canlı doğrulandı 2026-10-10). Uç/parametre bilgisi resmî portalın kendi istemci kodundan okunmuştur.
import type { CourtType } from '@eda/contracts/tools';

export const NORM_HOST = 'normkararlarbilgibankasi.anayasa.gov.tr';
export const BIREYSEL_HOST = 'kararlarbilgibankasi.anayasa.gov.tr';

/** Arama ve tekil karar ucu (iki alan adında aynı yol). */
export const AYM_SEARCH_PATH = '/api/core/public/search';

export const AYM_KINDS = {
  aym_norm: { kararTipi: 'NormDenetimi', prefix: 'ND', host: NORM_HOST },
  aym_bireysel: { kararTipi: 'BireyselBasvuru', prefix: 'BB', host: BIREYSEL_HOST },
} as const satisfies Partial<
  Record<CourtType, { kararTipi: string; prefix: string; host: string }>
>;

export type AymCourtType = keyof typeof AYM_KINDS;
export const AYM_COURT_TYPES = Object.keys(AYM_KINDS) as AymCourtType[];

export function isAymCourtType(c: string): c is AymCourtType {
  return c in AYM_KINDS;
}

export function courtTypeOfKararTipi(kararTipi: string): AymCourtType | null {
  for (const c of AYM_COURT_TYPES) if (AYM_KINDS[c].kararTipi === kararTipi) return c;
  return null;
}

export const AYM_COURT_NAME = 'Anayasa Mahkemesi';
