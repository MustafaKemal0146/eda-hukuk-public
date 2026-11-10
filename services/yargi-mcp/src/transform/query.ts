// Sorgu yardımcıları: anlamlı terimler, kanun adı çözümü ve madde sıralaması. Ham sorgu loglanmaz.
// Türkçe katlama yalnız `@eda/legal` `tr_fold` ile (023 §2.2).
import { tr_fold } from '@eda/legal/text';

const STOP = new Set([
  've',
  'veya',
  'ile',
  'icin',
  'hangi',
  'nasil',
  'nedir',
  'olan',
  'olarak',
  'gibi',
  'bir',
  'bu',
  'da',
  'de',
  'mi',
  'mu',
  'ise',
  'ya',
  'ki',
  'en',
  'cok',
  'daha',
  'kadar',
  'sonra',
  'once',
  'durum',
  'durumu',
  'durumda',
  'hakkinda',
  'iliskin',
  'dair',
  'karar',
  'kararlar',
  'kararlari',
  'yargitay',
  'danistay',
  'madde',
  'maddesi',
  'kanun',
  'kanunu',
  'sart',
  'sartlar',
  'sartlari',
  'gecerli',
  'gecerlilik',
  'gecerliligi',
]);

/** Anlamlı terimler: katlanmış, ≥ 3 harf, durdurma listesi dışı, tekil. */
export function queryTerms(query: string): string[] {
  const words = tr_fold(query).match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => w.length >= 3 && !STOP.has(w)))];
}

/** Ek toleransı için kök öneki: ilk 5 harf (Türkçe ekler sona gelir). */
export const stemOf = (term: string): string => term.slice(0, Math.min(term.length, 5));

/** Sık başvurulan kanun adları/kısaltmaları → kanun numarası (sorguda kanun numarası verilmediyse). */
const LAW_NAMES: readonly [RegExp, string][] = [
  [/\b(tbk|turk borclar kanunu|borclar kanunu)\b/, '6098'],
  [/\b(tmk|turk medeni kanunu|medeni kanun)\b/, '4721'],
  [/\b(hmk|hukuk muhakemeleri kanunu)\b/, '6100'],
  [/\b(iik|icra ve iflas kanunu)\b/, '2004'],
  [/\b(is kanunu)\b/, '4857'],
  [/\b(ttk|turk ticaret kanunu)\b/, '6102'],
  [/\b(tck|turk ceza kanunu)\b/, '5237'],
  [/\b(cmk|ceza muhakemesi kanunu)\b/, '5271'],
  [/\b(iyuk|idari yargilama usulu kanunu)\b/, '2577'],
  [/\b(kvkk|kisisel verilerin korunmasi kanunu)\b/, '6698'],
  [/\b(tuketicinin korunmasi hakkinda kanun)\b/, '6502'],
];

export function lawNoFromQuery(query: string): string | null {
  const f = tr_fold(query);
  for (const [rx, no] of LAW_NAMES) if (rx.test(f)) return no;
  return null;
}

export type ScoredArticle<T> = { item: T; score: number; snippet: string };

/**
 * uygulamadaki terim ile kanun metnindeki terim farklı olabilir ("tahliye taahhüdü" → TBK m. 352
 * "boşaltmayı yazılı olarak üstlendiği"). Katlanmış kök öneki → metinde aranacak karşılıklar.
 */
const LEGAL_SYNONYMS: readonly [string, readonly string[]][] = [
  ['tahli', ['bosalt']],
  ['taahh', ['ustlen']],
  ['fesih', ['feshet', 'fesh']],
  ['ihtiya', ['gereksinim']],
  ['zamanasim', ['zaman asim']],
  ['nafaka', ['nafaka']],
];

function variantsOf(stem: string): string[] {
  const out = [stem];
  for (const [prefix, alts] of LEGAL_SYNONYMS) if (stem.startsWith(prefix)) out.push(...alts);
  return out;
}

/** Maddeleri terim eşleşmesiyle puanlar (başlık ×2); en iyi `limit` madde ve eşleşme çevresinden özet. */
export function rankArticles<
  T extends { heading: string | null; markdown: string; repealed: boolean },
>(articles: readonly T[], query: string, limit: number, snippetMax = 300): ScoredArticle<T>[] {
  const stems = queryTerms(query)
    .filter((t) => !LAW_NAMES.some(([rx]) => rx.test(t)))
    .map(stemOf);
  if (stems.length === 0) return [];
  const scored = articles.flatMap((item) => {
    if (item.repealed) return [];
    const head = tr_fold(item.heading ?? '');
    const body = tr_fold(item.markdown);
    let score = 0;
    let matched = 0;
    let first = -1;
    for (const s of stems) {
      const vs = variantsOf(s);
      const inHead = vs.some((v) => head.includes(v));
      const at = vs.reduce((best, v) => {
        const i = body.indexOf(v);
        return i !== -1 && (best === -1 || i < best) ? i : best;
      }, -1);
      if (inHead || at !== -1) matched += 1;
      if (inHead) score += 2;
      if (at !== -1) {
        score += 1;
        if (first === -1 || at < first) first = at;
      }
    }
    if (score === 0) return [];
    // Önce kaç ayrı terimin karşılandığı, sonra başlık/gövde ağırlığı (tek terimli başlık eşleşmesi
    // iki terimi de karşılayan maddeyi geçmesin).
    score += matched * 10;
    const start = Math.max(0, first - 60);
    // tr_fold boşluk dizilerini teke indirir ve kırpar; özet aynı biçimdeki özgün metinden kesilir.
    const plain = item.markdown.replace(/\s+/g, ' ').trim();
    const snippet = `${start > 0 ? '…' : ''}${plain.slice(start, start + snippetMax - 2).trim()}…`;
    return [{ item, score, snippet }];
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
