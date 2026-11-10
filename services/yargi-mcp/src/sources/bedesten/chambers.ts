// Daire kodu ↔ Bedesten `birimAdi` (021 §5.7.1 tablosu). `birimAdi` yalnız tam adla eşleşir; yanlış
// biçim hata değil boş sonuç döndürür (canlı gözlem 2026-10-10). Canlı doğrulananlar: "N. Hukuk Dairesi",
// "N. Ceza Dairesi", "Hukuk Genel Kurulu", "N. Daire", "İdare Dava Daireleri Kurulu".
// AS-P11-06: "Büyük Gen.Kur." (DBGK) ve diğer kurul adları canlı denemede doğrulanamadı (0 sonuç);
// hukuk uzmanı / 082 kataloğu ile kesinleşir.
import type { CourtType } from '@eda/contracts/tools';

const ordinal = (prefix: string, max: number, suffix: string): [string, string][] =>
  Array.from({ length: max }, (_, i) => [`${prefix}${i + 1}`, `${i + 1}. ${suffix}`]);

const YARGITAY: [string, string][] = [
  ...ordinal('H', 23, 'Hukuk Dairesi'),
  ...ordinal('C', 23, 'Ceza Dairesi'),
  ['HGK', 'Hukuk Genel Kurulu'],
  ['CGK', 'Ceza Genel Kurulu'],
  ['BGK', 'Büyük Genel Kurulu'],
  ['HBK', 'Hukuk Daireleri Başkanlar Kurulu'],
  ['CBK', 'Ceza Daireleri Başkanlar Kurulu'],
];

const DANISTAY: [string, string][] = [
  ...ordinal('D', 17, 'Daire'),
  ['DBGK', 'Büyük Gen.Kur.'],
  ['IDDK', 'İdare Dava Daireleri Kurulu'],
  ['VDDK', 'Vergi Dava Daireleri Kurulu'],
  ['IBK', 'İçtihatları Birleştirme Kurulu'],
  ['IIK', 'İdari İşler Kurulu'],
  ['DBK', 'Başkanlar Kurulu'],
];

export const CHAMBER_TO_BIRIM: ReadonlyMap<string, string> = new Map([...YARGITAY, ...DANISTAY]);

const YARGITAY_BY_NAME = new Map(YARGITAY.map(([code, name]) => [name, code]));
const DANISTAY_BY_NAME = new Map(DANISTAY.map(([code, name]) => [name, code]));

/** Ters eşleme: mahkeme türüne göre (Danıştay "1. Daire" ile Yargıtay adları çakışmaz ama kurullar ayrık). */
export function chamberCodeOf(courtType: CourtType, birimAdi: string | null): string | null {
  if (!birimAdi) return null;
  const name = birimAdi.trim();
  if (courtType === 'yargitay' || courtType === 'kyb') return YARGITAY_BY_NAME.get(name) ?? null;
  if (courtType === 'danistay') return DANISTAY_BY_NAME.get(name) ?? null;
  return null;
}

/** Kodun ait olduğu mahkeme türü (court_types ile uyum denetimi). */
export function chamberCourt(code: string): 'yargitay' | 'danistay' | 'aym' | null {
  if (YARGITAY.some(([c]) => c === code)) return 'yargitay';
  if (DANISTAY.some(([c]) => c === code)) return 'danistay';
  if (code.startsWith('AYIM')) return 'aym';
  return null;
}
