// Parçalayıcı (034 §7.1–§7.2, §7.4). Saf ve belirlenimci: token sayacı (`countTokens`, TEI `/tokenize`
// veya mock) dışarıdan enjekte edilir, ağ / DB yok. Kurallar:
//  - Parça bölüm (madde) sınırını aşmaz; `text` bölüm metninin birebir dilimidir, ofsetler bölüm
//    metnindedir; parçalar arası yalnız boşluk kalır (kayıpsız örtme).
//  - Hedef gövde `retrieval.chunkTokensMin`–`Max` (350–450); paragraf → cümle → boşluk sırası; hedefin
//    altında kalan parça bir sonraki birimi inceltip doldurur; kuyruk kuralı; örtüşme yok.
//  - Paketleme birim sayılarının toplamıyla tahmin edilir; ikinci toplu ölçüm önek dahil
//    `corpus.chunkHardMaxTokens` (512) denetimidir: aşan parçada önce önek kısaltılır, sonra gövde
//    yarıya bölünür. `tokenCount` önek HARİÇ ölçülen gövde sayısıdır (030).
// Sayaç toplamsal değilse (özel token) tahmin üstten kalır; sınır ihlali ikinci ölçümle önlenir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { splitSentences, type TextSpan } from '../text/sentences.ts';
import { buildLawContextPrefix, type LawPrefixInput } from './embed-input.ts';
import { splitParagraphs } from './law-articles.ts';

export type CountTokens = (texts: readonly string[]) => Promise<number[]>;

export type ChunkLimits = { min: number; max: number; hardMax: number };

export const DEFAULT_CHUNK_LIMITS: ChunkLimits = {
  min: CONFIG_DEFAULTS['retrieval.chunkTokensMin'],
  max: CONFIG_DEFAULTS['retrieval.chunkTokensMax'],
  hardMax: CONFIG_DEFAULTS['corpus.chunkHardMaxTokens'],
};

export type SectionChunk = {
  text: string;
  /** Bölüm (madde) metni içinde `[charStart, charEnd)`. */
  charStart: number;
  charEnd: number;
  /** Önek hariç gövde token sayısı. */
  tokenCount: number;
  contextPrefix: string;
};

/** 0 paragraf / fıkra, 1 cümle, 2 sözcük. */
type Unit = TextSpan & { tokens: number; level: 0 | 1 | 2 };

async function measure(
  text: string,
  spans: readonly TextSpan[],
  count: CountTokens,
  level: Unit['level'],
): Promise<Unit[]> {
  if (spans.length === 0) return [];
  const n = await count(spans.map((s) => text.slice(s.start, s.end)));
  return spans.map((s, i) => ({ ...s, tokens: n[i] ?? 0, level }));
}

function trimmed(text: string, start: number, end: number): TextSpan | null {
  const slice = text.slice(start, end);
  const lead = slice.length - slice.trimStart().length;
  const body = slice.trim();
  return body === '' ? null : { start: start + lead, end: start + lead + body.length };
}

/** Satır sonu tek başına paragraf sınırıdır (034 §7.2). */
function paragraphSpans(text: string): TextSpan[] {
  const out: TextSpan[] = [];
  let at = 0;
  for (const m of text.matchAll(/\n+/g)) {
    const s = trimmed(text, at, m.index);
    if (s) out.push(s);
    at = m.index + m[0].length;
  }
  const s = trimmed(text, at, text.length);
  if (s) out.push(s);
  return out;
}

function wordSpans(text: string, span: TextSpan): TextSpan[] {
  return [...text.slice(span.start, span.end).matchAll(/\S+/g)].map((m) => ({
    start: span.start + m.index,
    end: span.start + m.index + m[0].length,
  }));
}

async function refine(text: string, u: Unit, count: CountTokens): Promise<Unit[] | null> {
  if (u.level === 0) {
    const sentences = splitSentences(text.slice(u.start, u.end))
      .map((s) => trimmed(text, u.start + s.start, u.start + s.end))
      .filter((s): s is TextSpan => s !== null);
    if (sentences.length > 1) return measure(text, sentences, count, 1);
  }
  if (u.level === 2) return null;
  const words = wordSpans(text, u);
  return words.length > 1 ? measure(text, words, count, 2) : null;
}

async function pack(
  text: string,
  units: Unit[],
  count: CountTokens,
  limits: ChunkLimits,
): Promise<Unit[]> {
  const queue = [...units];
  const chunks: Unit[] = [];
  let cur: Unit | null = null;
  while (queue.length > 0) {
    const u = queue.shift() as Unit;
    if (u.tokens > limits.max) {
      const finer = await refine(text, u, count);
      if (finer) {
        queue.unshift(...finer);
        continue;
      }
    }
    if (cur === null) {
      cur = u;
      continue;
    }
    if (cur.tokens + u.tokens <= limits.max) {
      cur = { start: cur.start, end: u.end, tokens: cur.tokens + u.tokens, level: cur.level };
      continue;
    }
    if (cur.tokens < limits.min) {
      const finer = await refine(text, u, count);
      if (finer) {
        queue.unshift(...finer);
        continue;
      }
    }
    chunks.push(cur);
    cur = u;
  }
  if (cur) chunks.push(cur);
  // Kuyruk kuralı: son parça hedefin altındaysa ve öncekiyle sığıyorsa birleşir.
  const last = chunks.at(-1);
  const prev = chunks.at(-2);
  if (last && prev && last.tokens < limits.min && prev.tokens + last.tokens <= limits.max) {
    chunks.splice(-2, 2, {
      start: prev.start,
      end: last.end,
      tokens: prev.tokens + last.tokens,
      level: prev.level,
    });
  }
  return chunks;
}

/** Gövdeyi ortaya en yakın boşluktan (yoksa karakter ortasından) ikiye böler. */
function halve(text: string, span: TextSpan): [TextSpan, TextSpan] | null {
  if (span.end - span.start < 2) return null;
  const mid = span.start + Math.floor((span.end - span.start) / 2);
  let best = -1;
  for (const m of text.slice(span.start, span.end).matchAll(/\s+/g)) {
    const at = span.start + m.index;
    if (at > span.start && (best < 0 || Math.abs(at - mid) < Math.abs(best - mid))) best = at;
  }
  const cut = best > 0 ? best : mid;
  const a = trimmed(text, span.start, cut);
  const b = trimmed(text, cut, span.end);
  return a && b ? [a, b] : null;
}

/** İkinci toplu ölçüm (034 §7.2-3): önek dahil ≤ hardMax; aşanda önek kısaltma, sonra gövde bölme. */
async function finalize(
  text: string,
  spans: readonly TextSpan[],
  prefixesFor: (span: TextSpan) => readonly string[],
  count: CountTokens,
  limits: ChunkLimits,
): Promise<SectionChunk[]> {
  if (spans.length === 0) return [];
  const bodies = spans.map((s) => text.slice(s.start, s.end));
  const firsts = spans.map((s) => prefixesFor(s)[0] ?? '');
  const n = await count([...bodies, ...bodies.map((b, i) => `${firsts[i]}${b}`)]);
  const out: SectionChunk[] = [];
  for (const [i, span] of spans.entries()) {
    const body = bodies[i] ?? '';
    const make = (prefix: string, tokens: number): SectionChunk => ({
      text: body,
      charStart: span.start,
      charEnd: span.end,
      tokenCount: tokens,
      contextPrefix: prefix,
    });
    if ((n[spans.length + i] ?? 0) <= limits.hardMax) {
      out.push(make(firsts[i] ?? '', n[i] ?? 0));
      continue;
    }
    const alternatives = prefixesFor(span).slice(1);
    if (alternatives.length > 0) {
      const c = await count(alternatives.map((p) => `${p}${body}`));
      const fit = c.findIndex((x) => x <= limits.hardMax);
      if (fit >= 0) {
        out.push(make(alternatives[fit] ?? '', n[i] ?? 0));
        continue;
      }
    }
    const halves = halve(text, span);
    if (!halves) throw new Error('Parça önek dahil sınıra sığdırılamadı: bölünemeyen gövde.');
    out.push(...(await finalize(text, halves, prefixesFor, count, limits)));
  }
  return out;
}

/**
 * Karar bölümü parçalama (034 §7.2). `prefixCandidates` önek adaylarıdır, uzundan kısaya
 * (`contextPrefixCandidates` / `buildContextPrefix`); ilki kullanılır, 512 aşımında sıradakine geçilir.
 */
export async function chunkSection(
  section: { text: string; prefixCandidates: readonly string[] },
  countTokens: CountTokens,
  limits: ChunkLimits = DEFAULT_CHUNK_LIMITS,
): Promise<SectionChunk[]> {
  const units = await measure(section.text, paragraphSpans(section.text), countTokens, 0);
  const spans = await pack(section.text, units, countTokens, limits);
  const prefixes = section.prefixCandidates.length > 0 ? section.prefixCandidates : [''];
  return finalize(section.text, spans, () => prefixes, countTokens, limits);
}

export type LawArticleChunkInput = Omit<LawPrefixInput, 'paragraphs'> & {
  /** Madde gövdesi (`law_articles.text`); başlık önekte ve gömme girdisinde yer almaz (034 §7.4). */
  text: string;
  status: 'in_force' | 'repealed';
};

/**
 * Mevzuat parçalama (034 §7.4): madde birimi; ≤ 450 token ise tek parça (önek fıkrasız); uzun madde
 * fıkra sınırından paketlenir, önek kapsanan fıkraları yazar (`m. 49/1-2`). Mülga madde parça üretmez.
 */
export async function chunkLawArticle(
  article: LawArticleChunkInput,
  countTokens: CountTokens,
  limits: ChunkLimits = DEFAULT_CHUNK_LIMITS,
): Promise<SectionChunk[]> {
  if (article.status === 'repealed') return [];
  const text = article.text;
  const whole = trimmed(text, 0, text.length);
  if (!whole) return [];
  const paras: (TextSpan & { no: number })[] = [];
  let at = 0;
  for (const p of splitParagraphs(text)) {
    const idx = text.indexOf(p.text, at);
    if (idx < 0) continue;
    paras.push({ start: idx, end: idx + p.text.length, no: p.no });
    at = idx + p.text.length;
  }
  // Birinci fıkra işaretçisinden önceki metin (varsa) ilk fıkraya katılır: örtme kayıpsız kalır.
  const head = paras[0];
  if (head && head.start > whole.start) head.start = whole.start;
  const [total] = await countTokens([text.slice(whole.start, whole.end)]);
  const prefixFor = (span: TextSpan): readonly string[] => {
    if (span.start === whole.start && span.end === whole.end) {
      return [buildLawContextPrefix({ ...article, paragraphs: null })];
    }
    const covered = paras.filter((p) => p.start < span.end && span.start < p.end).map((p) => p.no);
    return [buildLawContextPrefix({ ...article, paragraphs: covered.length > 0 ? covered : null })];
  };
  if ((total ?? 0) <= limits.max || paras.length === 0) {
    const spans =
      (total ?? 0) <= limits.max
        ? [whole]
        : await pack(text, await measure(text, [whole], countTokens, 0), countTokens, limits);
    return finalize(text, spans, prefixFor, countTokens, limits);
  }
  const units = await measure(text, paras, countTokens, 0);
  const spans = await pack(text, units, countTokens, limits);
  return finalize(text, spans, prefixFor, countTokens, limits);
}
