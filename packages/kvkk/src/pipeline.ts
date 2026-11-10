// Algılayıcı hattı (026 §6.1, §7.6.1 adım 3): köken politikasına göre aday toplama. mask, verify ve
// detectPii aynı işlevleri kullanır; algılayıcı istisnası DETECTOR_FAILED (fail-closed).
import { detectAddresses } from './detectors/address.ts';
import { type Candidate, PRIORITY, type StepBudget } from './detectors/candidate.ts';
import { detectCompanies } from './detectors/company.ts';
import { detectHealth } from './detectors/health.ts';
import { detectPersons } from './detectors/person.ts';
import { detectStructural } from './detectors/structural.ts';
import type { DictionaryInternal } from './dictionary/compile.ts';
import { type OriginPolicy, STRICT_STRUCTURAL } from './dictionary/origin-policy.ts';
import { scanCore } from './dictionary/scan.ts';
import { asMaskingError } from './errors.ts';
import type { ScanText } from './normalize.ts';
import type { KvkkLimits, Tip } from './types.ts';

const ALL_STRUCTURAL: ReadonlySet<Tip> = new Set([
  'IBAN',
  'EPOSTA',
  'TCKN',
  'TEL',
  'VKN',
  'PLAKA',
  'TARIH_DOGUM',
]);

export interface DetectConfig {
  policy: OriginPolicy;
  dict: DictionaryInternal | null;
  maskOwnCaseNumber: boolean;
  limits: KvkkLimits;
  budget: StepBudget;
  /** Hangi algılayıcı aileleri (mask: tümü; verify/standard: sözlük + sıkı yapısal). */
  level: 'full' | 'strict-structural';
  segmentId?: string;
}

export function collectCandidates(scan: ScanText, cfg: DetectConfig): Candidate[] {
  try {
    const out: Candidate[] = [];
    const p = cfg.policy;
    if (cfg.dict && p.dictionary) {
      out.push(
        ...scanCore(scan, cfg.dict.core, {
          source: 'dict',
          priority: PRIORITY.dict,
          allowDosya: p.dictionaryDosya && cfg.maskOwnCaseNumber,
          suffixMaxLetters: cfg.limits.suffixMaxLetters,
        }),
      );
    }
    if (p.strongPatterns) {
      const kinds = cfg.level === 'full' ? ALL_STRUCTURAL : STRICT_STRUCTURAL;
      out.push(
        ...detectStructural(scan, {
          kinds,
          vknWithoutContext: p.vknWithoutContext,
          budget: cfg.budget,
        }),
      );
    }
    if (cfg.level === 'full') {
      if (p.health) out.push(...detectHealth(scan));
      if (p.heuristics) {
        out.push(...detectCompanies(scan));
        out.push(...detectAddresses(scan, { addressMaxChars: cfg.limits.addressMaxChars }));
        out.push(...detectPersons(scan, { nameMaxWords: cfg.limits.nameMaxWords }));
      }
    }
    return out;
  } catch (e) {
    throw asMaskingError(e, 'DETECTOR_FAILED', cfg.segmentId);
  }
}
