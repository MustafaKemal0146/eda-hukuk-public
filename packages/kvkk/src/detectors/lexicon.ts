// Sözlükçe eşleştirici (SAGLIK ve hassas konu): katlanmış metinde sözcük başı eşleşmesi, terim + en
// çok 8 harf kesmesiz ek (026 §6.3, §7.7). Son sözcüğü <= 3 harf olan terimlerde (HIV, hepatit B) ek
// payı yoktur: tam sınır veya kesmeli ek gerekir (yanlış pozitif önlemi).

import { Automaton, surfaceKey } from '../dictionary/compile.ts';
import { isLetterChar, isWordChar } from '../fold.ts';

export interface LexiconHit {
  /** Tarama akışı aralığı (kesmesiz ek dahil). */
  start: number;
  end: number;
  term: number;
  /** Kesmeli ek (tarama akışı). */
  suffix?: { start: number; end: number };
}

const TAIL_MAX = 8;
const APOS_MAX = 12;

export class Lexicon {
  readonly #automaton: Automaton;
  readonly #shortTail: boolean[];

  constructor(terms: readonly string[]) {
    const keys = terms.map((t) => surfaceKey(t));
    this.#automaton = new Automaton(keys);
    this.#shortTail = keys.map((k) => {
      const last = k.split(' ').pop() ?? k;
      return last.length <= 3;
    });
  }

  scan(fold: string): LexiconHit[] {
    const hits: LexiconHit[] = [];
    this.#automaton.scan(fold, (s, e, term) => {
      if (s > 0 && isWordChar(fold.charAt(s - 1))) return;
      let end = e;
      let suffix: { start: number; end: number } | undefined;
      const next = fold.charAt(e);
      if (next === "'") {
        let k = e + 1;
        while (k < fold.length && k - e - 1 < APOS_MAX && isLetterChar(fold.charAt(k))) k += 1;
        if (k > e + 1 && !isWordChar(fold.charAt(k))) suffix = { start: e, end: k };
      } else if (isWordChar(next)) {
        if (this.#shortTail[term]) return;
        let k = e;
        while (k < fold.length && k - e < TAIL_MAX + 1 && isLetterChar(fold.charAt(k))) k += 1;
        if (k - e > TAIL_MAX || isWordChar(fold.charAt(k))) return;
        end = k;
      }
      const hit: LexiconHit = { start: s, end, term };
      if (suffix) hit.suffix = suffix;
      hits.push(hit);
    });
    return hits;
  }
}
