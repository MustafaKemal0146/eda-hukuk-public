// SIRKET algılayıcısı (026 §6.3): unvan eki sözlüğü (katlanmış, noktalama toleranslı); ek bulunduğunda
// sola en çok 6 sözcük genişletilir. Tüm span (ek dahil) tek token olur.

import { Automaton } from '../dictionary/compile.ts';
import { foldChars, isTrUpper, isWordChar } from '../fold.ts';
import { type ScanText, scanToNfc } from '../normalize.ts';
import { type Candidate, PRIORITY } from './candidate.ts';
import { isLegalTermWord } from './legal-terms.ts';

/** 026 §6.3 unvan ekleri (katlanmış) + noktalama toleranslı yazımlar. */
export const COMPANY_SUFFIXES: readonly string[] = [
  'a.s.',
  'a.s',
  'as',
  'anonim sirketi',
  'ltd. sti.',
  'ltd.sti.',
  'ltd. sti',
  'ltd sti',
  'limited sirketi',
  'ltd.',
  'ltd',
  'sti.',
  'san. ve tic.',
  'san. tic.',
  'san ve tic',
  'tic.',
  'koop.',
  'kooperatifi',
  'kollektif sirketi',
  'komandit sirketi',
  'holding',
];

const AUTOMATON = new Automaton(COMPANY_SUFFIXES);
const LEFT_MAX_WORDS = 6;
/** Unvan sözcüğü: harf/rakam ve . & ' - dışında karakter yok, en az bir harf. */
const COMPANY_WORD = /^(?=[^\p{L}]{0,24}\p{L})[\p{L}\d.&'’-]{1,40}$/u;

interface Hit {
  start: number;
  end: number;
}

function suffixHits(scan: ScanText): Hit[] {
  const f = scan.fold;
  const hits: Hit[] = [];
  AUTOMATON.scan(f, (s, e, id) => {
    if (s > 0 && isWordChar(f.charAt(s - 1))) return;
    const last = f.charAt(e - 1);
    if (last !== '.' && e < f.length && isWordChar(f.charAt(e))) return;
    // "as" yalnız BÜYÜK harf AŞ/AS biçiminde.
    if (COMPANY_SUFFIXES[id] === 'as') {
      const o = scan.orig.slice(s, e);
      if (o !== 'AŞ' && o !== 'AS') return;
    }
    hits.push({ start: s, end: e });
  });
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  // Ardışık ekleri zincirle ("San. ve Tic. Ltd. Şti.").
  const chains: Hit[] = [];
  for (const h of hits) {
    const last = chains[chains.length - 1];
    if (last && h.start <= last.end + 1 && h.start >= last.start) {
      if (h.end > last.end) last.end = h.end;
      continue;
    }
    chains.push({ ...h });
  }
  return chains;
}

interface LeftWord {
  start: number;
  end: number;
  text: string;
}

function wordBefore(orig: string, pos: number): LeftWord | null {
  // pos: önceki sözcüğün bittiği yerin hemen ardındaki tek ' '.
  if (pos <= 0 || orig.charAt(pos - 1) !== ' ') return null;
  const end = pos - 1;
  let start = end;
  while (start > 0) {
    const ch = orig.charAt(start - 1);
    if (ch === ' ' || ch === '\n') break;
    start -= 1;
  }
  if (start === end) return null;
  return { start, end, text: orig.slice(start, end) };
}

export function detectCompanies(scan: ScanText): Candidate[] {
  const out: Candidate[] = [];
  for (const chain of suffixHits(scan)) {
    let left = chain.start;
    const words: LeftWord[] = [];
    let cursor = chain.start;
    while (words.length < LEFT_MAX_WORDS) {
      const w = wordBefore(scan.orig, cursor);
      if (!w) break;
      const t = w.text;
      if (/[,;:]$/u.test(t)) break;
      const conj = t === 've' || t === '&';
      if (!conj && !COMPANY_WORD.test(t)) break;
      if (!conj && !isTrUpper(t.charAt(0)) && !/^\d/u.test(t)) break;
      if (!conj && isLegalTermWord(t)) break;
      words.push(w);
      cursor = w.start;
      left = w.start;
    }
    while (words.length > 0) {
      const lastWord = words[words.length - 1] as LeftWord;
      if (lastWord.text === 've' || lastWord.text === '&') {
        words.pop();
        left = words.length > 0 ? (words[words.length - 1] as LeftWord).start : chain.start;
      } else break;
    }
    if (words.length === 0) continue;
    const [start, end] = scanToNfc(scan, left, chain.end);
    const c: Candidate = {
      start,
      end,
      tip: 'SIRKET',
      source: 'heuristic',
      confidence: 'medium',
      priority: PRIORITY.SIRKET,
      learnable: {
        words: [],
        core: words
          .slice()
          .reverse()
          .map((w) => w.text)
          .join(' '),
      },
    };
    const ap = scan.orig.charAt(chain.end);
    if (ap === "'" || ap === '’') {
      let k = chain.end + 1;
      while (k < scan.orig.length && k - chain.end <= 12 && /\p{L}/u.test(scan.orig.charAt(k)))
        k += 1;
      if (k > chain.end + 1) {
        const [ss, se] = scanToNfc(scan, chain.end, k);
        c.suffix = { start: ss, end: se };
      }
    }
    out.push(c);
  }
  return out;
}

/** Sondaki en uzun unvan ekini atarak çekirdek ad (026 §7.2); ek yoksa null. */
export function stripCompanySuffix(name: string): string | null {
  const f = foldChars(name);
  let best = -1;
  for (const s of COMPANY_SUFFIXES) {
    if (f.endsWith(s) && f.length > s.length) {
      const before = f.charAt(f.length - s.length - 1);
      if (before !== ' ') continue;
      const cut = f.length - s.length;
      if (best < 0 || cut < best) best = cut;
    }
  }
  if (best < 0) return null;
  let core = name.slice(0, best).trim();
  // Zincir: "Mavi Yapı San. ve Tic. Ltd. Şti." -> tekrar dene.
  const again = stripCompanySuffix(core);
  if (again !== null) core = again;
  return core.length > 0 ? core : null;
}
