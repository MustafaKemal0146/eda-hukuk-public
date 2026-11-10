// Korpus madde atfı çıkarıcısı (034 §3.2 `cited_articles`; 023 §4.1 R2). P14 K6 dar bir ayrıştırıcı
// (A1, A3, A4) öngörüyordu; 025 §8.1 ayrıştırıcısı (`extractArticleCitations`, A1–A7) zaten
// bulunduğundan ikinci desen kümesi yazılmaz: bu dosya yalnız onun çıktısını madde anahtarlarına
// çevirir. Bilinmeyen kısaltma atıf sayılmaz (sözlük `law-aliases.ts`); numarası olmayan
// metinler (AİHS) atılır. Saf.
import { tr_upper } from '../text/normalize.ts';
import { extractArticleCitations } from './extract.ts';
import { lawByNo } from './law-aliases.ts';
import type { ArticleCitationExtractor, CitedArticleRef } from './ports.ts';
import type { ArticleRef } from './types.ts';

/** 034 §3.2: karar başına en çok bu kadar tekil atıf saklanır. */
export const CITED_ARTICLES_MAX = 200;

/**
 * "m. 49/A" harfli madde, "m. 7/a" bent (081 §4.3 gösterimi: harfli madde büyük, bent küçük harf).
 * 025 ayrıştırıcısı ikisini ayırt etmez (normalize metin); ayrım özgün dilimdeki harf büyüklüğüyle
 * yapılır. Bent atfı madde anahtarına harf eklemez.
 */
function articleNoOf(a: ArticleRef, raw: string): string {
  if (a.paragraph !== null || a.sub === null || a.key.startsWith('M')) return a.key;
  if (!/^\p{L}$/u.test(a.sub)) return a.key;
  const num = a.key.replace(/^[GE]/, '');
  const m = new RegExp(`(?<!\\d)${num}\\s*[/-]\\s*(\\p{L})(?!\\p{L})`, 'u').exec(raw);
  const letter = m?.[1];
  if (letter === undefined || letter !== tr_upper(letter)) return a.key;
  return `${a.key}/${tr_upper(letter)}`;
}

/** Metindeki tüm madde atıfları, geçiş sırasıyla ve yinelemeli (önek sıklığı için; 034 §7.3). */
export function articleOccurrences(text: string): CitedArticleRef[] {
  const out: CitedArticleRef[] = [];
  const cites = extractArticleCitations(text).sort((a, b) => a.span.start - b.span.start);
  for (const c of cites) {
    const lawNo = c.article?.lawNo;
    if (!c.article || !lawNo) continue;
    const lawType = lawByNo(lawNo)?.lawType === 'anayasa' ? 'constitution' : 'law';
    for (const a of c.article.articles) {
      out.push({ lawNo, lawType, articleNo: articleNoOf(a, c.raw) });
    }
  }
  return out;
}

/** Tekilleştirilmiş (ilk görülme sırası), en çok `CITED_ARTICLES_MAX` öğe. */
export const extractArticleRefs: ArticleCitationExtractor = (text) => {
  const seen = new Set<string>();
  const out: CitedArticleRef[] = [];
  for (const ref of articleOccurrences(text)) {
    const key = `${ref.lawNo}|${ref.articleNo}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
    if (out.length === CITED_ARTICLES_MAX) break;
  }
  return out;
};
