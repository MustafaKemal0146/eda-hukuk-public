// 026 §10.2 sınırları: değerler 002 §7.1 `kvkk.*` anahtarlarından (config/defaults.ts zinciri); paket
// içinde sayı gömülmez. Çağıran (test, adaptör) yalnız açıkça verdiği alanları değiştirir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { KvkkLimits } from './types.ts';

export const DEFAULT_LIMITS: Readonly<KvkkLimits> = Object.freeze({
  maskInputMaxChars: CONFIG_DEFAULTS['kvkk.maskInputMaxChars'],
  windowBudgetFactor: CONFIG_DEFAULTS['kvkk.windowBudgetFactor'],
  learnedMaxSurfaces: CONFIG_DEFAULTS['kvkk.learnedMaxSurfaces'],
  dictionaryMaxSurfaces: CONFIG_DEFAULTS['kvkk.dictionaryMaxSurfaces'],
  nameMaxWords: CONFIG_DEFAULTS['kvkk.nameMaxWords'],
  addressMaxChars: CONFIG_DEFAULTS['kvkk.addressMaxChars'],
  weakVariantMinChars: CONFIG_DEFAULTS['kvkk.weakVariantMinChars'],
  suffixMaxLetters: CONFIG_DEFAULTS['kvkk.suffixMaxLetters'],
});

export function resolveLimits(partial?: Partial<KvkkLimits>): KvkkLimits {
  return { ...DEFAULT_LIMITS, ...(partial ?? {}) };
}
