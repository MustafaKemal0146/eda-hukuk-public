// Ek varyantı üretimi `generateTails(word)` (026 §7.2): sözcüğün son ses bilgisine göre geçerli ek
// zincirlerinin kesmesiz gerçeklenmiş kümesi; en çok 8 harf, en çok 64 dizge (başlangıç varsayımı).
import { CASES, type Morpheme } from './morphemes.ts';
import { stemInfo } from './phonology.ts';
import { realizeChain } from './realize.ts';

export const TAIL_MAX_LETTERS = 8;
export const TAIL_MAX_COUNT = 64;

const CHAINS: readonly (readonly Morpheme[])[] = (() => {
  const out: Morpheme[][] = [];
  for (const plural of [false, true]) {
    for (const poss of [false, true]) {
      for (const kase of [null, ...CASES] as (Morpheme | null)[]) {
        for (const end of [null, 'KI', 'COP'] as (Morpheme | null)[]) {
          if (end === 'KI' && kase !== 'GEN' && kase !== 'LOC') continue;
          const chain: Morpheme[] = [];
          if (plural) chain.push('PLURAL');
          if (poss) chain.push('POSS3');
          if (kase) chain.push(kase);
          if (end) chain.push(end);
          if (chain.length > 0) out.push(chain);
        }
      }
    }
  }
  return out;
})();

const cache = new Map<string, ReadonlySet<string>>();

export function generateTails(word: string): ReadonlySet<string> {
  const hit = cache.get(word);
  if (hit) return hit;
  const stem = stemInfo(word, 'KISI');
  const realized = CHAINS.map((c, idx) => ({ s: realizeChain(c, stem), idx }))
    .filter((r) => r.s.length <= TAIL_MAX_LETTERS)
    .sort((a, b) => a.s.length - b.s.length || a.idx - b.idx);
  const set = new Set<string>();
  for (const r of realized) {
    if (set.size >= TAIL_MAX_COUNT) break;
    set.add(r.s);
  }
  const frozen: ReadonlySet<string> = set;
  if (cache.size > 4096) cache.clear();
  cache.set(word, frozen);
  return frozen;
}
