// Alıntı denetimi (025 §6): yanıttaki tırnak içi doğrudan alıntıları çıkarır, `[K#]` etiketine atfeder ve
// kaynağın metninde normalize alt dize olarak arar. Bulanık eşleşme YOKTUR. Saf işlevler; ağ, saat, log yok.
// Karşılaştırma `tr_fold` ile yapılır (025 §6.3'teki `tr_normalize` adımı + `çğıöşü` katlaması): model
// şapka/çengel düşürse bile yanlış alarm üretilmez. Üç nokta ile kısaltılmış alıntıda parçalar kaynakta
// SIRAYLA geçmelidir (025 §6.4'teki "sıra denetlenmez" sınırının sıkılaştırılmış hâli).
import { tr_fold } from '../text/normalize.ts';

export type QuoteSpan = { start: number; end: number };

export type ExtractedQuote = {
  /** Tırnakların içindeki özgün metin. */
  quote: string;
  /** Açılış tırnağından kapanış tırnağının sonrasına kadar (özgün metin ofsetleri). */
  span: QuoteSpan;
};

export type AttributedQuote = ExtractedQuote & { ref: string };

export type QuoteMatch =
  | { status: 'matched'; fragments: number }
  | { status: 'mismatch'; fragments: number }
  | { status: 'too_short' };

/** Açılış → kabul edilen kapanış tırnakları. Tipografik tırnaklar ayrı çiftlenir. */
const QUOTE_PAIRS: Readonly<Record<string, string>> = {
  '"': '"',
  '“': '”',
  '„': '“”',
  '«': '»',
};
const QUOTE_CHARS = /["“”„«»]/;

/** Paragraf sınırı: arada yalnız boşluk olan iki satır sonu. */
const PARAGRAPH_BREAK = /\n[ \t]*\n/g;

/**
 * Etiket grubu: `[K1]` ya da `[K1, K2]`. Çoklu grup alıntıyı tek kaynağa bağlayamaz (belirsiz).
 */
const TAG_GROUP = /\[\s*(K[1-9]\d*(?:\s*[,;]\s*K[1-9]\d*)*)\s*\]/g;

/** Cümle sonu: rakamdan sonra gelmeyen nokta/ünlem/soru + boşluk + büyük harf ("3. Hukuk" sayılmaz). */
const SENTENCE_END = /(?<!\d)[.!?]\s+\p{Lu}/u;

/** Kısaltma işaretleri: `…`, `...`, `[…]`, `[...]`, `[mahkeme]`, `(...)`, `(…)` (025 §6.3-2). */
const ELLIPSIS = /\[[^\]\n]*\]|\(\s*(?:\.{2,}|…)\s*\)|\.{3,}|…/gu;

/** 025 §6.3: `tr_fold` → harf-rakam dışı diziler tek boşluk → kırpma. */
export function quoteCmpNorm(text: string): string {
  return tr_fold(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function paragraphs(text: string): QuoteSpan[] {
  const out: QuoteSpan[] = [];
  let last = 0;
  PARAGRAPH_BREAK.lastIndex = 0;
  for (let m = PARAGRAPH_BREAK.exec(text); m !== null; m = PARAGRAPH_BREAK.exec(text)) {
    out.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  out.push({ start: last, end: text.length });
  return out;
}

/**
 * Tırnak çiftlerini çıkarır (025 §6.2-1). Çift aynı paragrafta kapanmalıdır (tek satır sonu serbest);
 * kapanmayan (dengesiz) tırnak yoksayılır. Karşılaştırma uzunluğu `minChars` altındaki alıntı terimdir,
 * denetlenmez.
 */
export function extractQuotes(text: string, opts: { minChars: number }): ExtractedQuote[] {
  const out: ExtractedQuote[] = [];
  for (const para of paragraphs(text)) {
    let i = para.start;
    while (i < para.end) {
      const ch = text[i] ?? '';
      const closers = QUOTE_PAIRS[ch];
      if (closers === undefined) {
        i += 1;
        continue;
      }
      let j = i + 1;
      while (j < para.end && !closers.includes(text[j] ?? '')) j += 1;
      if (j >= para.end) {
        // Dengesiz tırnak: bu açılış atlanır, tarama sonraki karakterden sürer.
        i += 1;
        continue;
      }
      const quote = text.slice(i + 1, j);
      if (quoteCmpNorm(quote.replace(ELLIPSIS, ' ')).length >= opts.minChars) {
        out.push({ quote, span: { start: i, end: j + 1 } });
      }
      i = j + 1;
    }
  }
  return out;
}

function paragraphOf(paras: readonly QuoteSpan[], at: number): QuoteSpan {
  return paras.find((p) => at >= p.start && at <= p.end) ?? { start: 0, end: at };
}

/** Grup tek etiketse etiketi, çoklu grupsa null (belirsiz). */
function singleRef(group: string): string | null {
  const refs = group.split(/[,;]/).map((s) => s.trim());
  return refs.length === 1 ? (refs[0] ?? null) : null;
}

/**
 * Alıntıyı etikete atfeder (025 §6.2-2): kapanıştan sonra pencere içinde, aynı paragraf ve aynı cümlede
 * ilk etiket; yoksa açılıştan önce pencere içindeki son etiket. Belirsizlikte (çoklu grup, yan yana iki
 * etiket, arada başka alıntı) atıf yapılmaz: yanlış kaynağa bağlanan alıntı yanlış alarm üretir.
 */
export function attributeQuote(
  text: string,
  q: ExtractedQuote,
  opts: { windowChars: number },
  paras: readonly QuoteSpan[] = paragraphs(text),
): string | null {
  const para = paragraphOf(paras, q.span.start);
  // Sonra gelen etiket.
  const afterEnd = Math.min(para.end, q.span.end + opts.windowChars);
  const after = text.slice(q.span.end, afterEnd);
  TAG_GROUP.lastIndex = 0;
  const next = TAG_GROUP.exec(after);
  if (next) {
    const gap = after.slice(0, next.index);
    if (!QUOTE_CHARS.test(gap) && !SENTENCE_END.test(gap)) {
      const rest = after.slice(next.index + next[0].length);
      const adjacent = /^\s*\[\s*K[1-9]/.test(rest);
      const ref = singleRef(next[1] ?? '');
      return adjacent ? null : ref;
    }
  }
  // Önce gelen etiket.
  const beforeStart = Math.max(para.start, q.span.start - opts.windowChars);
  const before = text.slice(beforeStart, q.span.start);
  let prev: RegExpExecArray | null = null;
  TAG_GROUP.lastIndex = 0;
  for (let m = TAG_GROUP.exec(before); m !== null; m = TAG_GROUP.exec(before)) prev = m;
  if (!prev) return null;
  const gap = before.slice(prev.index + prev[0].length);
  if (SENTENCE_END.test(gap)) return null;
  // Yan yana iki etiket ("[K1][K2] şöyle der: …") alıntıyı tek kaynağa bağlamaz.
  if (/\[\s*K[1-9]\d*(?:\s*[,;]\s*K[1-9]\d*)*\s*\]\s*$/.test(before.slice(0, prev.index))) {
    return null;
  }
  return singleRef(prev[1] ?? '');
}

/** Çıkarma + atfetme; atıfsız alıntılar dönmez (denetlenmez, 025 §6.2-2). */
export function extractAttributedQuotes(
  text: string,
  opts: { minChars: number; windowChars: number },
): AttributedQuote[] {
  const paras = paragraphs(text);
  return extractQuotes(text, opts).flatMap((q) => {
    const ref = attributeQuote(text, q, opts, paras);
    return ref === null ? [] : [{ ...q, ref }];
  });
}

/**
 * Alıntıyı kaynak metin(ler)inde arar (025 §6.4). Alıntı kısaltma işaretlerinden parçalara bölünür;
 * `fragmentMinChars` altındaki parçalar göz ardı edilir, hiç uzun parça yoksa `too_short`. Uzun parçalar
 * kaynak metinde (metinler sırayla birleştirilir) SIRAYLA geçmelidir.
 */
export function matchQuote(
  quote: string,
  haystacks: readonly string[],
  opts: { fragmentMinChars: number },
): QuoteMatch {
  const fragments = quote
    .split(ELLIPSIS)
    .map(quoteCmpNorm)
    .filter((f) => f.length >= opts.fragmentMinChars);
  if (fragments.length === 0) return { status: 'too_short' };
  const hay = ` ${haystacks.map(quoteCmpNorm).join(' ')} `;
  let pos = 0;
  for (const f of fragments) {
    const at = hay.indexOf(f, pos);
    if (at === -1) return { status: 'mismatch', fragments: fragments.length };
    pos = at + f.length;
  }
  return { status: 'matched', fragments: fragments.length };
}
