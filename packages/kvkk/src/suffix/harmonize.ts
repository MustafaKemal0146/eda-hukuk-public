// Ek uyumlayıcı `harmonizeSuffix` (026 §7.5): modelin token ardından yazdığı eki gerçek değerin son
// sesine göre yeniden kurar. Kurallar dil uzmanınca doğrulanana kadar `verified: false`.
import { isAllUpper, trUpper } from '../fold.ts';
import type { Tip } from '../types.ts';
import { parseSuffix } from './parse.ts';
import { stemInfo } from './phonology.ts';
import { realizeChain } from './realize.ts';

export interface HarmonizeOutcome {
  text: string;
  parsed: boolean;
  ambiguous: boolean;
}

export function harmonize(
  display: string,
  tip: Tip,
  writtenSuffix: string,
  apostrophe = "'",
): HarmonizeOutcome {
  const parsed = parseSuffix(writtenSuffix);
  if (!parsed)
    return { text: `${display}${apostrophe}${writtenSuffix}`, parsed: false, ambiguous: false };
  let suffix = realizeChain(parsed.chain, stemInfo(display, tip));
  if (isAllUpper(display)) suffix = trUpper(suffix);
  return { text: `${display}${apostrophe}${suffix}`, parsed: true, ambiguous: parsed.ambiguous };
}

/** Görünen değer + kesme + uyumlanmış ek; çözümlenemeyen ek aynen korunur (fail-soft). */
export function harmonizeSuffix(
  display: string,
  tip: Tip,
  writtenSuffix: string,
  apostrophe = "'",
): string {
  return harmonize(display, tip, writtenSuffix, apostrophe).text;
}
