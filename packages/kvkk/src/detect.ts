// Yalnız algılama (026 §7.7): `detectPii`, `piiDetected`, `sensitiveTopic`. Bu işlevler veri sınıfını
// ASLA düşürmez (Y-24); yalnız maskeleme önizlemesi, Genel araştırma (kamu) engeli ve hassas konu
// yerleşim yükseltmesi için kullanılır. `standard`: sözlük + yapısal; `strict`: ek olarak KISI, SIRKET,
// ADRES, SAGLIK, TARIH_DOGUM sezgileri. Köken varsayılanı `user_text` (en sıkı).
import { StepBudget } from './detectors/candidate.ts';
import { resolveCandidates } from './detectors/resolve.ts';
import { dictionaryInternal } from './dictionary/compile.ts';
import { policyFor } from './dictionary/origin-policy.ts';
import { asMaskingError } from './errors.ts';
import { escapedRanges } from './escape.ts';
import { resolveLimits } from './limits.ts';
import { buildScan, normalizeText } from './normalize.ts';
import { collectCandidates } from './pipeline.ts';
import type { CompiledDictionary, Detection, DetectOptions, KvkkLimits } from './types.ts';

export { sensitiveTopic } from './detectors/topics.ts';

export function detectPii(
  text: string,
  opts: DetectOptions & { limits?: Partial<KvkkLimits> },
): Detection[] {
  try {
    const limits = resolveLimits(opts.limits);
    const dict = opts.dictionary ? dictionaryInternal(opts.dictionary) : null;
    const norm = normalizeText(text);
    const occupied = new Uint8Array(norm.orig.length);
    for (const [s, e] of escapedRanges(norm.orig)) for (let i = s; i < e; i += 1) occupied[i] = 1;
    const candidates = collectCandidates(buildScan(norm, occupied), {
      policy: policyFor(opts.origin ?? 'user_text'),
      dict,
      maskOwnCaseNumber: true,
      limits,
      budget: new StepBudget(limits.windowBudgetFactor * Math.max(text.length, 64)),
      level: opts.level === 'strict' ? 'full' : 'strict-structural',
    });
    return resolveCandidates(candidates, norm.orig.length, occupied).map((c) => ({
      tip: c.tip,
      start: c.start,
      end: c.end,
      confidence: c.confidence,
      source: c.source,
    }));
  } catch (e) {
    throw asMaskingError(e, 'DETECTOR_FAILED');
  }
}

export function piiDetected(
  text: string,
  opts: { level: 'standard' | 'strict'; dictionary?: CompiledDictionary | null } = {
    level: 'standard',
  },
): boolean {
  return detectPii(text, { level: opts.level, dictionary: opts.dictionary ?? null }).length > 0;
}
