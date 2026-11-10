// Bedesten yanıtı → NormalizedDecision (021 §5.5, §5.7.1 yanıt eşlemesi).
import type { NormalizedDecisionValue } from '@eda/contracts/mcp';
import type { CourtType } from '@eda/contracts/tools';
import { trDateToIso } from '../dates.ts';
import { decisionTitle } from '../normalize-common.ts';
import { chamberCodeOf } from './chambers.ts';
import type { BedestenDecisionItemValue } from './client.ts';
import { bedestenPublicUrl } from './document-id.ts';

/** court_type ↔ itemType (021 §5.6; tümü 2026-10-10 canlı doğrulandı, `DANISTAYKARAR` dahil). */
export const BEDESTEN_ITEM_TYPES = {
  yargitay: 'YARGITAYKARARI',
  danistay: 'DANISTAYKARAR',
  istinaf_hukuk: 'ISTINAFHUKUK',
  ilk_derece_hukuk: 'YERELHUKUK',
  kyb: 'KYB',
} as const satisfies Partial<Record<CourtType, string>>;
export type BedestenCourtType = keyof typeof BEDESTEN_ITEM_TYPES;
export const BEDESTEN_COURT_TYPES = Object.keys(BEDESTEN_ITEM_TYPES) as BedestenCourtType[];

const BY_ITEM_TYPE = new Map<string, BedestenCourtType>(
  Object.entries(BEDESTEN_ITEM_TYPES).map(([k, v]) => [v, k as BedestenCourtType]),
);

export function courtTypeOfItem(itemType: string): BedestenCourtType | null {
  return BY_ITEM_TYPE.get(itemType) ?? null;
}

const BAM = /^(.*?Bölge Adliye Mahkemesi)\s+(.+)$/;

/** Görünen mahkeme / daire ayrımı. */
export function splitCourt(
  courtType: BedestenCourtType,
  birimAdi: string | null,
): { court: string; chamber: string | null } {
  const b = birimAdi?.trim() || null;
  switch (courtType) {
    case 'yargitay':
    case 'kyb':
      return { court: 'Yargıtay', chamber: b };
    case 'danistay':
      return { court: 'Danıştay', chamber: b };
    case 'istinaf_hukuk': {
      const m = b ? BAM.exec(b) : null;
      if (m?.[1] && m[2]) return { court: m[1], chamber: m[2] };
      return { court: b ?? 'Bölge Adliye Mahkemesi', chamber: null };
    }
    case 'ilk_derece_hukuk':
      return { court: b ?? 'İlk Derece Mahkemesi', chamber: null };
  }
}

const pairNo = (
  full: string | null | undefined,
  yil: number | null | undefined,
  sira: number | null | undefined,
): string | null => {
  if (full && /^\d{4}\/\d{1,7}$/.test(full.trim())) return full.trim();
  return yil && sira ? `${yil}/${sira}` : null;
};

export function normalizeSearchItem(
  item: BedestenDecisionItemValue,
  retrievedAt: string,
): NormalizedDecisionValue | null {
  const courtType = courtTypeOfItem(item.itemType.name);
  if (!courtType) return null;
  const { court, chamber } = splitCourt(courtType, item.birimAdi ?? null);
  const esasNo = pairNo(item.esasNo, item.esasNoYil, item.esasNoSira);
  const kararNo = pairNo(item.kararNo, item.kararNoYil, item.kararNoSira);
  const facets: NonNullable<NormalizedDecisionValue['facets']> = [];
  if (item.kararTuru) facets.push({ key: 'karar_turu', value: item.kararTuru.slice(0, 300) });
  if (item.kesinlesmeDurumu) {
    facets.push({ key: 'kesinlesme', value: item.kesinlesmeDurumu.slice(0, 300) });
  }
  return {
    source: 'bedesten',
    document_id: item.documentId,
    court_type: courtType,
    court,
    chamber,
    chamber_code: chamberCodeOf(courtType, item.birimAdi ?? null),
    esas_no: esasNo,
    karar_no: kararNo,
    decision_date: trDateToIso(item.kararTarihiStr),
    title: decisionTitle(court, chamber, esasNo, kararNo),
    snippet: null,
    url: bedestenPublicUrl(item.documentId),
    retrieved_at: retrievedAt,
    origin: 'live',
    facets: facets.length > 0 ? facets : null,
  };
}

/** Belge başlığından künye (ör. "3. Hukuk Dairesi 2022/8302 E. , 2023/167 K."). */
export type DocHeaderMeta = {
  courtType: BedestenCourtType | null;
  court: string | null;
  chamber: string | null;
  esasNo: string | null;
  kararNo: string | null;
  decisionDate: string | null;
};

export function parseDocHeader(markdown: string): DocHeaderMeta {
  const head = markdown.slice(0, 1500);
  const firstLine =
    head
      .split('\n')
      .map((l) => l.replace(/[*_#]/g, '').trim())
      .find((l) => l.length > 0) ?? '';
  const ek = /^(.+?)\s+(\d{4}\/\d{1,7})\s*E\.\s*,?\s*(\d{4}\/\d{1,7})\s*K\./.exec(firstLine);
  const esas = ek?.[2] ?? /ESAS NO\s*:?\s*(\d{4}\/\d{1,7})/.exec(head)?.[1] ?? null;
  const karar = ek?.[3] ?? /KARAR NO\s*:?\s*(\d{4}\/\d{1,7})/.exec(head)?.[1] ?? null;
  const date = /KARAR TARİHİ\s*:?\s*(\d{2}[./]\d{2}[./]\d{4})/.exec(head)?.[1] ?? null;
  const chamberText = ek?.[1]?.trim() ?? null;
  let courtType: BedestenCourtType | null = null;
  if (chamberText) {
    if (/Bölge Adliye Mahkemesi/.test(chamberText)) courtType = 'istinaf_hukuk';
    else if (
      /(Hukuk|Ceza) (Dairesi|Genel Kurulu)|Başkanlar Kurulu|Büyük Genel Kurulu/.test(chamberText)
    ) {
      courtType = 'yargitay';
    } else if (
      /^\d{1,2}\. Daire$|Daireleri Kurulu|İçtihatları Birleştirme|İdari İşler/.test(chamberText)
    ) {
      courtType = 'danistay';
    }
  } else if (/MAHKEMESİ/.test(head) && /ESAS NO/.test(head)) {
    courtType = 'ilk_derece_hukuk';
  }
  const split = courtType && chamberText ? splitCourt(courtType, chamberText) : null;
  return {
    courtType,
    court: split?.court ?? null,
    chamber: split?.chamber ?? null,
    esasNo: esas,
    kararNo: karar,
    decisionDate: trDateToIso(date),
  };
}
