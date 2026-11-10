// Atıftan pasaja eşleme (#58): yanıtta `[K#]` ile atıf yapılan cümle, modelin okuduğu kaynak metinde
// (SourceItem.excerpt) deterministik olarak bulunur. Model "şu cümle önemli" diyemez; eşleme yalnız
// metin üzerinden hesaplanır: önce tırnak içi alıntının birebir geçtiği aralık, yoksa en çok ortak
// sözcük kökü taşıyan cümle(ler). Eşleşme yoksa vurgu uydurulmaz.
import { splitCitations } from './citations.ts';

export type Range = { start: number; end: number };

export type Passage = {
  ranges: Range[];
  /** `quote`: tırnak içi ifade metinde birebir bulundu; `overlap`: ortak sözcük köküne göre. */
  kind: 'quote' | 'overlap';
  /** Yanıtta tırnak içinde olup kaynak metinde birebir geçmeyen alıntılar. */
  unmatchedQuotes: string[];
};

const SENTENCE_END = /(?<=[.!?…;])\s+|\n+/;
const QUOTE_RE = /["“”«][^"“”«»]{12,}?["“”»]/g;
const MIN_STEM = 4;
const STEM_LEN = 5;

const fold = (s: string): string => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ');

function stems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of fold(text).match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length >= MIN_STEM) out.add(w.slice(0, STEM_LEN));
  }
  return out;
}

/** Yanıt metninde `ref` etiketli cümle(ler); etiketler ve markdown süsleri atılır. */
export function claimFor(answer: string, ref: string): string {
  const sentences = answer.split(SENTENCE_END);
  const claims: string[] = [];
  sentences.forEach((raw, i) => {
    const segs = splitCitations(raw);
    const cites = segs.some((s) => s.type === 'cite' && s.refs.includes(ref));
    if (!cites) return;
    const clean = clearMarkup(segs.map((s) => (s.type === 'text' ? s.value : '')).join(''));
    // "... karar verdi. [K1]" biçiminde etiket tek başına kaldıysa önceki cümleye bakılır.
    if (clean.length >= 8) claims.push(clean);
    else if (i > 0 && sentences[i - 1] !== undefined) {
      const prev = clearMarkup(
        splitCitations(sentences[i - 1] ?? '')
          .map((s) => (s.type === 'text' ? s.value : ''))
          .join(''),
      );
      if (prev) claims.push(prev);
    }
  });
  return claims.join(' ');
}

function clearMarkup(s: string): string {
  return s
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Metin parçalarını konumlarıyla verir (vurgu aralığı `excerpt` içinde kalır). */
function sentenceSpans(text: string): Range[] {
  const spans: Range[] = [];
  let start = 0;
  const re = /(?<=[.!?…;])\s+|\n+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > start) spans.push({ start, end: m.index });
    start = m.index + m[0].length;
  }
  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

/** Alıntı aralığı: boşluk ve büyük/küçük harf farkı yok sayılarak birebir aranır. */
function findQuote(excerpt: string, quote: string): Range | null {
  const hay = excerpt.toLocaleLowerCase('tr');
  const needle = quote.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  const direct = hay.indexOf(needle);
  if (direct >= 0) return { start: direct, end: direct + needle.length };
  // Kaynakta satır sonu/çoklu boşluk varsa: boşlukları gevşek eşleyen desen.
  const pattern = needle
    .split(' ')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+');
  const m = new RegExp(pattern, 'u').exec(hay);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

export function findPassage(claim: string, excerpt: string): Passage | null {
  if (!claim.trim() || !excerpt.trim()) return null;
  const quotes = (claim.match(QUOTE_RE) ?? []).map((q) => q.slice(1, -1).trim());
  const found: Range[] = [];
  const unmatchedQuotes: string[] = [];
  for (const q of quotes) {
    const r = findQuote(excerpt, q);
    if (r) found.push(r);
    else unmatchedQuotes.push(q);
  }
  if (found.length > 0) return { ranges: found, kind: 'quote', unmatchedQuotes };

  const claimStems = stems(claim);
  if (claimStems.size === 0)
    return quotes.length > 0 ? { ranges: [], kind: 'overlap', unmatchedQuotes } : null;
  const scored = sentenceSpans(excerpt).map((span) => {
    let score = 0;
    for (const s of stems(excerpt.slice(span.start, span.end))) if (claimStems.has(s)) score += 1;
    return { span, score };
  });
  const best = Math.max(0, ...scored.map((s) => s.score));
  // En az üç ortak kök: tek tesadüfi sözcük eşleşmesi pasaj sayılmaz.
  if (best < 3) return quotes.length > 0 ? { ranges: [], kind: 'overlap', unmatchedQuotes } : null;
  const ranges = scored
    .filter((s) => s.score >= best * 0.7)
    .slice(0, 3)
    .map((s) => s.span);
  return { ranges, kind: 'overlap', unmatchedQuotes };
}

/** Metni vurgulu/vurgusuz parçalara böler (örtüşen aralıklar birleştirilir). */
export function splitByRanges(
  text: string,
  ranges: readonly Range[],
): { text: string; mark: boolean }[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: { text: string; mark: boolean }[] = [];
  let cursor = 0;
  for (const r of sorted) {
    const start = Math.max(r.start, cursor);
    if (r.end <= start) continue;
    if (start > cursor) out.push({ text: text.slice(cursor, start), mark: false });
    out.push({ text: text.slice(start, r.end), mark: true });
    cursor = r.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), mark: false });
  return out;
}
