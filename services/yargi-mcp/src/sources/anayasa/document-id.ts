// AYM belge kimliği (021 §5.6): norm `ND/<karar yılı>/<karar sırası>`, bireysel `BB/<başvuru yılı>/<sıra>`.
// Kimlik URL değildir; host sabitten gelir, yol `new URL()` sonrası ikinci kez denetlenir (KK-021-11).
import { AYM_KINDS, type AymCourtType } from './codes.ts';

const NORM_ID = /^ND\/(\d{4}\/[1-9]\d{0,3})$/;
const BIREYSEL_ID = /^BB\/(\d{4}\/[1-9]\d{0,5})$/;

export type AymDocRef = { courtType: AymCourtType; number: string };

export function parseAnayasaId(id: string): AymDocRef | null {
  const norm = NORM_ID.exec(id);
  if (norm?.[1]) return { courtType: 'aym_norm', number: norm[1] };
  const bb = BIREYSEL_ID.exec(id);
  if (bb?.[1]) return { courtType: 'aym_bireysel', number: bb[1] };
  return null;
}

/** Künye numarasından belge kimliği; biçim dışıysa null (sonuç listeden düşer). */
export function anayasaDocumentId(courtType: AymCourtType, number: string | null): string | null {
  if (number === null) return null;
  const id = `${AYM_KINDS[courtType].prefix}/${number}`;
  return parseAnayasaId(id) ? id : null;
}

export function anayasaPublicUrl(ref: AymDocRef): string {
  const { host, prefix } = AYM_KINDS[ref.courtType];
  const path = `/${prefix}/${ref.number}`;
  const url = new URL(`https://${host}${path}`);
  if (url.host !== host || url.pathname !== path || url.search !== '') {
    throw new Error('belge kimliği geçersiz');
  }
  return url.toString();
}
