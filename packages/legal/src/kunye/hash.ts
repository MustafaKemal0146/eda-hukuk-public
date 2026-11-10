// Künye hash girdisi (034 §8.3). Saf: SHA-256 burada hesaplanmaz; çağıran (worker, api) bu dizeyi
// `node:crypto` ile özetler. Alım tarafı (P14b) ve canlı birleştirme (P14c, 023 §4.10) aynı işlevi
// kullanır; daire (`unit_key`) hash'e dahildir: 9. HD ile 10. HD'nin aynı esası ayrı kalır.
import type { SearchCourtType } from '@eda/contracts/enums';
import { tr_fold } from '../text/normalize.ts';

export type KunyeHashFields = {
  courtType: SearchCourtType;
  chamberCode: string | null;
  chamberRaw: string | null;
  courtName: string | null;
  /** `canonicalizeCaseNo` çıktısı (`2024/123`); yoksa `null`. */
  esasCanon: string | null;
  kararCanon: string | null;
};

/** `unit_key` = `chamber_code`; yoksa `tr_fold(chamber_raw ?? court_name)`; eksik alan boş dize. */
export function kunyeUnitKey(
  f: Pick<KunyeHashFields, 'chamberCode' | 'chamberRaw' | 'courtName'>,
): string {
  if (f.chamberCode) return f.chamberCode;
  return tr_fold(f.chamberRaw ?? f.courtName ?? '');
}

/**
 * `court_type|unit_key|esas|karar`; esas ve karar ikisi de yoksa `null` (hash üretilmez; alım zaten
 * `no_kunye` ile reddeder).
 */
export function kunyeHashInput(f: KunyeHashFields): string | null {
  if (!f.esasCanon && !f.kararCanon) return null;
  return [f.courtType, kunyeUnitKey(f), f.esasCanon ?? '', f.kararCanon ?? ''].join('|');
}
