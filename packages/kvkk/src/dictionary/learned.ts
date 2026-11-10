// Öğrenilen yüzey yayılımı (026 §6.7): geçiş 1'de kabul edilmiş sözlük dışı KISI/SIRKET adaylarından
// L kümesi kurulur ve TÜM segmentlerde ipucu aranmadan taranır (öncelik 95). Kalıcı durum yoktur;
// yükün işlevidir. Ortak varyant >= 2 tam adda görülürse belirsizdir (kimlik canon(varyant)).
import type { Candidate } from '../detectors/candidate.ts';
import { isLegalTermWord } from '../detectors/legal-terms.ts';
import { KvkkMaskingError } from '../errors.ts';
import { canon } from '../tokens/canon.ts';
import type { KvkkLimits } from '../types.ts';
import { buildCore, type DictionaryCore, type SurfaceRecord, surfaceKey } from './compile.ts';

function letters(s: string): number {
  let n = 0;
  for (const ch of s) if (/\p{L}/u.test(ch)) n += 1;
  return n;
}

export interface LearnedSet {
  core: DictionaryCore | null;
  size: number;
}

interface Variant {
  surface: string;
  tip: 'KISI' | 'SIRKET';
  full: string;
  display: string;
}

export function buildLearned(
  accepted: readonly { candidate: Candidate; text: string }[],
  limits: KvkkLimits,
): LearnedSet {
  const variants: Variant[] = [];
  const min = limits.weakVariantMinChars;
  for (const { candidate: c, text } of accepted) {
    if (c.source !== 'heuristic') continue;
    const display = c.displaySurface ?? text;
    if (c.tip === 'KISI') {
      const ws = (c.learnable?.words ?? []).filter((w) => w.length > 0);
      if (ws.length < 2) continue;
      const fullText = c.identitySurface ?? ws.join(' ');
      const full = canon('KISI', fullText);
      const add = (surface: string) => variants.push({ surface, tip: 'KISI', full, display });
      add(ws.join(' '));
      const lastWord = ws[ws.length - 1] as string;
      const firstWord = ws[0] as string;
      add(`${lastWord} ${ws.slice(0, -1).join(' ')}`);
      if (letters(lastWord) >= Math.max(4, min) && !isLegalTermWord(lastWord)) add(lastWord);
      if (
        !firstWord.endsWith('.') &&
        letters(firstWord) >= Math.max(4, min) &&
        !isLegalTermWord(firstWord)
      ) {
        add(firstWord);
      }
    } else if (c.tip === 'SIRKET') {
      const full = canon('SIRKET', text);
      variants.push({ surface: text, tip: 'SIRKET', full, display });
      const core = c.learnable?.core ?? '';
      const coreWords = core.split(' ').filter((w) => w.length > 0);
      if (
        core &&
        (coreWords.length >= 2 || letters(core) >= 6) &&
        !isLegalTermWord(core) &&
        letters(core) >= min
      ) {
        variants.push({ surface: core, tip: 'SIRKET', full, display });
      }
    }
  }
  // Varyant -> farklı tam adlar; >= 2 ise belirsiz.
  const owners = new Map<string, Set<string>>();
  for (const v of variants) {
    const k = `${v.tip}\u0000${surfaceKey(v.surface)}`;
    const s = owners.get(k) ?? new Set<string>();
    s.add(v.full);
    owners.set(k, s);
  }
  const records: SurfaceRecord[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    const k = `${v.tip}\u0000${surfaceKey(v.surface)}`;
    const ambiguous = (owners.get(k)?.size ?? 0) > 1;
    const identity = ambiguous ? canon(v.tip, v.surface) : v.full;
    const dedupe = `${k}\u0000${identity}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    records.push({ tip: v.tip, identity, display: ambiguous ? '' : v.display, surface: v.surface });
  }
  if (records.length > limits.learnedMaxSurfaces) {
    throw new KvkkMaskingError('BUDGET_EXCEEDED', { count: records.length });
  }
  if (records.length === 0) return { core: null, size: 0 };
  return { core: buildCore(records), size: records.length };
}
