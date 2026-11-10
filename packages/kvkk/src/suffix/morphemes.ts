// Soyut ek envanteri (026 §7.5 (1)); uzun yazım önce denenir. Zincir dilbilgisi:
// PLURAL? POSS3? CASE? (KI | COP)?  ;  CASE ∈ {GEN, DAT, ACC, LOC, ABL, INS}.

export const MORPHEMES = [
  'PLURAL',
  'POSS3',
  'GEN',
  'DAT',
  'ACC',
  'LOC',
  'ABL',
  'INS',
  'KI',
  'COP',
] as const;
export type Morpheme = (typeof MORPHEMES)[number];

export const CASES: readonly Morpheme[] = ['GEN', 'DAT', 'ACC', 'LOC', 'ABL', 'INS'];

const byLengthDesc = (forms: string[]): readonly string[] =>
  [...forms].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));

export const SURFACE_FORMS: Readonly<Record<Morpheme, readonly string[]>> = {
  PLURAL: byLengthDesc(['lar', 'ler']),
  GEN: byLengthDesc(['nın', 'nin', 'nun', 'nün', 'ın', 'in', 'un', 'ün']),
  DAT: byLengthDesc(['ya', 'ye', 'na', 'ne', 'a', 'e']),
  ACC: byLengthDesc(['yı', 'yi', 'yu', 'yü', 'nı', 'ni', 'nu', 'nü', 'ı', 'i', 'u', 'ü']),
  LOC: byLengthDesc(['nda', 'nde', 'da', 'de', 'ta', 'te']),
  ABL: byLengthDesc(['ndan', 'nden', 'dan', 'den', 'tan', 'ten']),
  INS: byLengthDesc(['yla', 'yle', 'la', 'le']),
  POSS3: byLengthDesc(['sı', 'si', 'su', 'sü', 'ı', 'i', 'u', 'ü']),
  COP: byLengthDesc(['dır', 'dir', 'dur', 'dür', 'tır', 'tir', 'tur', 'tür']),
  KI: ['ki'],
};
