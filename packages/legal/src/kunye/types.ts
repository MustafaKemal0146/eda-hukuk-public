// Ayrıştırıcı ve biçimleyici tipleri (025 §2.2 şekillerinin saf TS karşılığı). : Zod şemaları
// `@eda/contracts/api/citations` ile P13'te bağlanır; ayrıştırıcı saf kalır ve bu tipleri döndürür.
import type { CanonNo } from './canonical.ts';

export const COURT_CLASSES = [
  'yargitay',
  'danistay',
  'istinaf_hukuk',
  'istinaf_ceza',
  'bim',
  'yerel',
  'yerel_diger',
  'kyb',
  'aym_norm',
  'aym_bireysel',
  'uyusmazlik',
  'sayistay',
  'kik',
  'rekabet',
  'gib',
  'kurul_diger',
  'resmi_gazete',
] as const;
export type CourtClass = (typeof COURT_CLASSES)[number];

/** MVP'de çözülmeyen (kapsam dışı) sınıflar (025 §5.7, §5.8-2). */
export const OUT_OF_COVERAGE_CLASSES: ReadonlySet<CourtClass> = new Set([
  'kik',
  'rekabet',
  'gib',
  'kurul_diger',
  'sayistay',
  'bim',
  'resmi_gazete',
  'istinaf_ceza',
  'yerel_diger',
]);

export type ParsedKunye = {
  courtClass: CourtClass;
  courtLabel: string | null;
  chamberCode: string | null;
  esas: CanonNo | null;
  karar: CanonNo | null;
  basvuruNo: CanonNo | null;
  date: string | null;
  authorityNo: string | null;
  inferred: boolean;
  lowConfidence: boolean;
};

export type ArticleRef = { key: string; paragraph: number | null; sub: string | null };

export type ParsedArticle = {
  lawNo: string | null;
  abbr: string | null;
  articles: ArticleRef[];
  open: boolean;
};

export type Impossible = 'future_date' | 'karar_before_esas' | 'unknown_chamber' | 'zero_seq';

export type ExclusionReason = 'own_file_mask' | 'own_file_cue' | 'file_only_lower' | 'header_zone';

export type ParsedCitation = {
  kind: 'decision_free' | 'article' | 'authority_other';
  kunye: ParsedKunye | null;
  article: ParsedArticle | null;
  /** Özgün metin ofseti (kod birimi), `raw = text.slice(start, end)`. */
  span: { start: number; end: number };
  raw: string;
  impossible: Impossible[];
};

export type ExcludedCitation = { reason: ExclusionReason; span: { start: number; end: number } };
