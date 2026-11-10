export { isAsciiEmail, normalizeEmail } from './email.ts';
export {
  hasLegalTerm,
  LAW_ABBREVIATION_TERMS,
  PROTECTED_LEGAL_TERMS,
} from './legal-terms.ts';
export { type Normalized, normalizeWithMap, tr_fold, tr_normalize, tr_upper } from './normalize.ts';
export { SENTENCE_ABBREVIATIONS, splitSentences, type TextSpan } from './sentences.ts';
export { hasTurkishSpecificChars } from './turkish-chars.ts';
