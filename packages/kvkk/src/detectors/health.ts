// SAGLIK algılayıcısı (026 §6.3): yalnız Seviye A sözlükçesi; span terim + kesmesiz ektir; kimlik
// sözlükçe teriminin kendisidir (aynı terimin çekimleri aynı token).
import { HEALTH_LEXICON } from '../data/health-lexicon.tr.ts';
import { type ScanText, scanToNfc } from '../normalize.ts';
import { type Candidate, PRIORITY } from './candidate.ts';
import { Lexicon } from './lexicon.ts';

const LEXICON = new Lexicon(HEALTH_LEXICON);

export function detectHealth(scan: ScanText): Candidate[] {
  return LEXICON.scan(scan.fold).map((h) => {
    const [start, end] = scanToNfc(scan, h.start, h.end);
    const c: Candidate = {
      start,
      end,
      tip: 'SAGLIK',
      source: 'lexicon',
      confidence: 'medium',
      priority: PRIORITY.SAGLIK,
      identitySurface: HEALTH_LEXICON[h.term] ?? '',
    };
    if (h.suffix) {
      const [ss, se] = scanToNfc(scan, h.suffix.start, h.suffix.end);
      c.suffix = { start: ss, end: se };
    }
    return c;
  });
}
