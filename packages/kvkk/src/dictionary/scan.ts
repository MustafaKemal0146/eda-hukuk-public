// Sözlük taraması ve sınır kuralı (026 §7.3): kelime içi alt dizge eşleşmesi yoktur. Sağ sınır:
// metin sonu / harf-rakam olmayan karakter; ya da kesme + 1..12 harf (ek yakalanır); ya da kesmesiz
// 1..8 harf ve bu dizi `generateTails(son sözcük)` kümesinde. Tek sözcüklü KISI/SIRKET varyantı özgün
// metinde TITLE veya UPPER olmalıdır (küçük harfli tek sözcük eşleşmez; bilinçli artık risk).

import type { Candidate } from '../detectors/candidate.ts';
import { shapeOf } from '../detectors/words.ts';
import { foldChars, isLetterChar, isWordChar } from '../fold.ts';
import { type ScanText, scanToNfc } from '../normalize.ts';
import { generateTails } from '../suffix/tails.ts';
import type { SpanSource } from '../types.ts';
import type { DictionaryCore } from './compile.ts';

const TAIL_MAX = 8;
const foldedTails = new Map<string, ReadonlySet<string>>();

function tailsFor(word: string): ReadonlySet<string> {
  let t = foldedTails.get(word);
  if (!t) {
    t = new Set([...generateTails(word)].map((x) => foldChars(x)));
    if (foldedTails.size > 4096) foldedTails.clear();
    foldedTails.set(word, t);
  }
  return t;
}

export interface CoreScanOptions {
  source: SpanSource;
  priority: number;
  allowDosya: boolean;
  suffixMaxLetters: number;
}

export function scanCore(scan: ScanText, core: DictionaryCore, opts: CoreScanOptions): Candidate[] {
  const f = scan.fold;
  const o = scan.orig;
  const out: Candidate[] = [];
  core.automaton.scan(f, (s, e, id) => {
    const p = core.payloads[id];
    if (!p) return;
    if (p.tip === 'DOSYA' && !opts.allowDosya) return;
    if (s > 0 && isWordChar(f.charAt(s - 1))) return;
    let suffix: { start: number; end: number } | undefined;
    const next = f.charAt(e);
    if (e < f.length && isWordChar(next)) {
      // Kesmesiz ek: yalnız harf, <= 8, üretilen ek kümesinde.
      let k = e;
      while (k < f.length && k - e <= TAIL_MAX && isLetterChar(f.charAt(k))) k += 1;
      if (k - e > TAIL_MAX || (k < f.length && isWordChar(f.charAt(k)))) return;
      const matched = o.slice(s, e);
      const lastWord = matched.slice(matched.lastIndexOf(' ') + 1);
      if (!tailsFor(lastWord).has(f.slice(e, k))) return;
      suffix = { start: e, end: k };
    } else if (next === "'") {
      let k = e + 1;
      while (k < f.length && k - e - 1 < opts.suffixMaxLetters && isLetterChar(f.charAt(k))) k += 1;
      if (k > e + 1 && !(k < f.length && isLetterChar(f.charAt(k)))) suffix = { start: e, end: k };
    }
    if (p.single && (p.tip === 'KISI' || p.tip === 'SIRKET')) {
      const shape = shapeOf(o.slice(s, e));
      if (shape !== 'TITLE' && shape !== 'UPPER') return;
    }
    const [start, end] = scanToNfc(scan, s, e);
    const c: Candidate = {
      start,
      end,
      tip: p.tip,
      source: opts.source,
      confidence: 'high',
      priority: opts.priority,
      identity: p.identity,
    };
    if (!p.ambiguous && p.display) c.display = p.display;
    if (p.ambiguous) c.ambiguous = true;
    if (p.weak) c.weak = true;
    if (suffix) {
      const [ss, se] = scanToNfc(scan, suffix.start, suffix.end);
      c.suffix = { start: ss, end: se };
    }
    out.push(c);
  });
  return out;
}
