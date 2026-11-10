// Bağımsız doğrulama `verifyMasked` (026 §7.6.3): maskeli metni token aralıkları HARİÇ sözlük
// otomatının tüm yüzeyleri ve sıkı yapısal algılayıcılarla (TCKN, VKN, IBAN, EPOSTA, TEL, PLAKA) yeniden
// tarar; her tokenın tabloda karşılığı olduğunu denetler. Rapor metin taşımaz (yalnız tip ve ofset).
import { StepBudget } from './detectors/candidate.ts';
import { type DictionaryInternal, dictionaryInternal } from './dictionary/compile.ts';
import { policyFor } from './dictionary/origin-policy.ts';
import { asMaskingError } from './errors.ts';
import { escapedRanges } from './escape.ts';
import { resolveLimits } from './limits.ts';
import { maskMeta } from './mask.ts';
import { buildScan, normalizeText } from './normalize.ts';
import { collectCandidates } from './pipeline.ts';
import { tokenRegex } from './tokens/grammar.ts';
import type {
  CompiledDictionary,
  KvkkLimits,
  MaskResult,
  VerifyHit,
  VerifyReport,
} from './types.ts';

export function verifyMasked(
  result: MaskResult,
  dictionary: CompiledDictionary | null,
  opts: { limits?: Partial<KvkkLimits> } = {},
): VerifyReport {
  try {
    const limits = resolveLimits(opts.limits);
    const dict: DictionaryInternal | null = dictionary ? dictionaryInternal(dictionary) : null;
    const meta = maskMeta(result);
    const total = result.segments.reduce((n, s) => n + s.text.length, 0);
    const budget = new StepBudget(limits.windowBudgetFactor * Math.max(total, 64));
    const hits: VerifyHit[] = [];
    for (const seg of result.segments) {
      if (seg.protected) continue;
      const norm = normalizeText(seg.text);
      const blank = new Uint8Array(norm.orig.length);
      for (const m of norm.orig.matchAll(tokenRegex())) {
        const end = m.index + m[0].length;
        for (let i = m.index; i < end; i += 1) blank[i] = 1;
        if (!seg.preMasked && result.table.get(m[0]) === undefined) {
          hits.push({ segmentId: seg.id, tip: null, kind: 'unknown_token', start: m.index, end });
        }
      }
      for (const [s, e] of escapedRanges(norm.orig)) for (let i = s; i < e; i += 1) blank[i] = 1;
      const found = collectCandidates(buildScan(norm, blank), {
        policy: policyFor(seg.origin),
        dict,
        maskOwnCaseNumber: meta.maskOwnCaseNumber,
        limits,
        budget,
        level: 'strict-structural',
        segmentId: seg.id,
      });
      for (const c of found) {
        hits.push({ segmentId: seg.id, tip: c.tip, kind: 'surface', start: c.start, end: c.end });
      }
    }
    return { ok: hits.length === 0, hits };
  } catch (e) {
    throw asMaskingError(e, 'VERIFY_FAILED');
  }
}
