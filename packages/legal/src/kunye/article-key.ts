// Madde anahtarı (034 §9.3; 023 §8): `352`, `352/A`, geçici `G5`, ek `E3`, mükerrer `M18`. Ayrıştırıcı
// (`parseLawArticles`), yargi-mcp `article_no` çıktısı ve künye biçimleyicisi aynı anahtar uzayını
// kullanır. Kullanıcı / model girdisi ("Geçici 1", "GEÇİCİ MADDE 1", "Ek 3", "g1") anahtara çevrilir.
// Saf işlev; (madde anahtarı tüketici uyumu).
import { tr_normalize, tr_upper } from '../text/normalize.ts';

export const ARTICLE_KEY_PREFIXES = ['', 'G', 'E', 'M'] as const;
export type ArticleKeyPrefix = (typeof ARTICLE_KEY_PREFIXES)[number];

export type ArticleKeyParts = { prefix: ArticleKeyPrefix; number: number; letter: string | null };

const PREFIX_OF: Readonly<Record<string, ArticleKeyPrefix>> = {
  geçici: 'G',
  ek: 'E',
  mükerrer: 'M',
  g: 'G',
  e: 'E',
  m: 'M',
};

const KEY_INPUT =
  /^(?:(geçici|ek|mükerrer|[gem])\s*)?(?:madde\s*)?(\d{1,4})(?:\s*\/\s*([a-zçğıöşü]))?$/u;

/** "352", "352/a", "G5", "Geçici 5", "GEÇİCİ MADDE 5", "Ek 3", "E3", "Mükerrer 18", "M18" → parçalar. */
export function parseArticleKey(input: string): ArticleKeyParts | null {
  const m = KEY_INPUT.exec(tr_normalize(input).trim());
  if (!m) return null;
  const prefix = m[1] ? (PREFIX_OF[m[1]] ?? '') : '';
  // Mükerrer maddede harf yoktur (034 §9.3).
  const letter = m[3] && prefix !== 'M' ? tr_upper(m[3]) : null;
  return { prefix, number: Number(m[2]), letter };
}

export function articleKeyText(k: ArticleKeyParts): string {
  return `${k.prefix}${k.number}${k.letter ? `/${k.letter}` : ''}`;
}

/** Girdiyi 034 §9.3 anahtarına çevirir; çözülemezse `null`. */
export function normalizeArticleKey(input: string): string | null {
  const k = parseArticleKey(input);
  return k ? articleKeyText(k) : null;
}

export type ArticleSpan = { from: string; to: string | null };

/**
 * Tek madde veya aralık girdisi → kanonik anahtarlar: "344-346", "G1-G5", "Geçici 1 - Geçici 5",
 * "geçici 1-5" (bitiş başlangıcın türünü alır). Tire sonrası tek harf aralık değil harfli maddedir
 * ("49-A" = 49/A, URL biçimi). Çözülemezse `null`.
 */
export function parseArticleSpan(input: string): ArticleSpan | null {
  const single = parseArticleKey(input);
  if (single) return { from: articleKeyText(single), to: null };
  const m = /^(.+?)\s*-\s*(.+)$/u.exec(input.trim());
  if (!m?.[1] || !m[2]) return null;
  const from = parseArticleKey(m[1]);
  if (!from) return null;
  if (/^\p{L}$/u.test(m[2]) && from.letter === null && from.prefix !== 'M') {
    return { from: articleKeyText({ ...from, letter: tr_upper(m[2]) }), to: null };
  }
  const bare = /^\d{1,4}$/.test(m[2].trim());
  const to = bare
    ? { prefix: from.prefix, number: Number(m[2].trim()), letter: null }
    : parseArticleKey(m[2]);
  if (!to) return null;
  const fromKey = articleKeyText(from);
  const toKey = articleKeyText(to);
  return { from: fromKey, to: toKey === fromKey ? null : toKey };
}

/** Kanonik aralık metni: "344", "344-346", "G1-G5". */
export function articleSpanText(span: ArticleSpan): string {
  return span.to === null ? span.from : `${span.from}-${span.to}`;
}

/** Madde başlık satırı: "Madde 352", "Madde 352/A", "Geçici Madde 1", "Ek Madde 3", "Mükerrer Madde 18". */
export function articleHeadingText(key: string): string {
  const k = parseArticleKey(key);
  if (!k) return `Madde ${key.trim()}`;
  const head = { '': 'Madde', G: 'Geçici Madde', E: 'Ek Madde', M: 'Mükerrer Madde' }[k.prefix];
  return `${head} ${k.number}${k.letter ? `/${k.letter}` : ''}`;
}
