// İçe aktarma rol tanıma tabloları (054 §11.4) — HUKUK ONAYI BEKLİYOR (054 Açık Soru 14).
// Metin `tr_fold` ile katlanır, noktalama/boşluk/`:` temizlenir ve TAM eşleşme aranır; kısmi veya
// benzerlik tahmini yoktur. Etiket listesi 080'de genişler.
import type { SectionRole } from '@eda/contracts/enums';
import { tr_fold } from '@eda/legal/text';

/** Belgenin başındaki en çok ortalı paragraf sayısı (mahkeme başlığı). */
export const COURT_HEADER_MAX_PARAGRAPHS = 4;
export const COURT_HEADER_KEYWORDS = ['mahkemesi', 'hakimligi', 'mahkemesine', 'makamina'] as const;

export const PARTY_LABEL_WORDS = [
  'davaci',
  'davali',
  'vekili',
  'mudahil',
  'sanik',
  'sikayetci',
  'katilan',
  'alacakli',
  'borclu',
  'basvurucu',
] as const;

export const SUBJECT_LABELS = ['konu', 'dava degeri'] as const;

/** Bölüm başlığı (katlanmış, temizlenmiş tam metin) -> rol. */
export const HEADING_ROLES: Readonly<Record<string, SectionRole>> = {
  aciklamalar: 'numberedExplanations',
  'hukuki sebepler': 'legalGrounds',
  'hukuki nedenler': 'legalGrounds',
  deliller: 'evidenceList',
  'hukuki deliller': 'evidenceList',
  'delil listesi': 'evidenceList',
  'sonuc ve istem': 'resultAndRequest',
  'netice ve talep': 'resultAndRequest',
  'netice i talep': 'resultAndRequest',
  'sonuc ve talep': 'resultAndRequest',
};

/** Belgenin sonundaki en çok kısa paragraf sayısı (vekil imzası). */
export const SIGNATURE_MAX_PARAGRAPHS = 6;
/** "Kısa paragraf" üst sınırı (karakter); ölçülmemiş başlangıç değeri. */
export const SIGNATURE_LINE_MAX_CHARS = 120;
export const SIGNATURE_KEYWORDS = ['vekili', 'av'] as const;

/** `tr_fold` + noktalama ve `:` temizliği + tek boşluk. */
export function foldLabel(text: string): string {
  return tr_fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Etiket bölümü: ilk `:` veya sekmeye kadar olan metin; yoksa `null`. */
export function labelOf(text: string): string | null {
  const m = /^([^:\t]+)[:\t]/.exec(text);
  return m === null ? null : (m[1] ?? null);
}

export function words(folded: string): string[] {
  return folded === '' ? [] : folded.split(' ');
}
