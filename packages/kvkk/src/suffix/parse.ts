// Yazılan ekin soyut zincire çözümlenmesi (026 §7.5 (1)): derinlik öncelikli arama; ı/i/u/ü tek
// başına ACC/POSS3 belirsizse ACC seçilir. Çözümlenemeyen ek null döner (çağıran aynen korur).
import { trLower } from '../fold.ts';
import { CASES, type Morpheme, SURFACE_FORMS } from './morphemes.ts';

export interface ParsedSuffix {
  chain: Morpheme[];
  ambiguous: boolean;
}

type Slot = readonly Morpheme[];
const SLOTS: readonly Slot[] = [['PLURAL'], ['POSS3'], CASES, ['KI', 'COP']];

function search(s: string, pos: number, slot: number, acc: Morpheme[], out: Morpheme[][]): void {
  if (out.length > 16) return;
  if (pos === s.length) {
    if (acc.length > 0) out.push([...acc]);
    return;
  }
  for (let k = slot; k < SLOTS.length; k += 1) {
    for (const m of SLOTS[k] ?? []) {
      // KI yalnız GEN/LOC ardından (Türkçe "-nınki", "-daki").
      if (m === 'KI') {
        const prev = acc[acc.length - 1];
        if (prev !== 'GEN' && prev !== 'LOC') continue;
      }
      for (const form of SURFACE_FORMS[m]) {
        if (s.startsWith(form, pos)) {
          acc.push(m);
          search(s, pos + form.length, k + 1, acc, out);
          acc.pop();
        }
      }
    }
  }
}

function score(chain: readonly Morpheme[]): number {
  // Az biçimbirim önce; eşitlikte POSS3 yerine ACC (026 §7.5).
  return chain.length * 10 + chain.filter((m) => m === 'POSS3').length;
}

export function parseSuffix(written: string): ParsedSuffix | null {
  const s = trLower(written);
  if (s.length === 0) return null;
  const found: Morpheme[][] = [];
  search(s, 0, 0, [], found);
  if (found.length === 0) return null;
  found.sort((a, b) => score(a) - score(b));
  const best = found[0] ?? [];
  const distinct = new Set(found.map((c) => c.join('+')));
  return { chain: best, ambiguous: distinct.size > 1 };
}
