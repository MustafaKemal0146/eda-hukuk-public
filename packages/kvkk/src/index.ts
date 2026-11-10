// @eda/kvkk dış yüzeyi (026 §1.2). Maskeleme = takma adlaştırma: maskelenmiş veri kişisel veri olmaya
// devam eder (Y-124). Paket saftır: ağ, DB, dosya, saat yok; kripto CryptoPort ile enjekte edilir.
export { isValidIban } from './checksums/iban.ts';
export { isValidPhone } from './checksums/phone.ts';
export { isValidTckn } from './checksums/tckn.ts';
export { isValidVkn } from './checksums/vkn.ts';
export { detectPii, piiDetected, sensitiveTopic } from './detect.ts';
export { LEGAL_TERMS } from './detectors/legal-terms.ts';
export { compileDictionary } from './dictionary/compile.ts';
export { sourcesFromInput } from './dictionary/from-input.ts';
export {
  KVKK_MASKING_ERROR_CODES,
  KvkkMaskingError,
  type KvkkMaskingErrorCode,
} from './errors.ts';
export { foldChars } from './fold.ts';
export { DEFAULT_LIMITS } from './limits.ts';
export { mask } from './mask.ts';
export type { ClockPort, CryptoPort } from './ports.ts';
export { harmonizeSuffix } from './suffix/harmonize.ts';
export { generateTails } from './suffix/tails.ts';
export { deriveConvKey } from './tokens/derive.ts';
export { TOKEN_MAX_LEN } from './tokens/grammar.ts';
export type {
  CompiledDictionary,
  Detection,
  DetectOptions,
  DictionaryInput,
  DictionaryOptions,
  DictionarySource,
  KvkkLimits,
  MaskedSegmentResult,
  MaskInput,
  MaskOptions,
  MaskResult,
  MaskSegment,
  MaskStats,
  OriginKind,
  PartyRole,
  SegmentCache,
  SensitiveTopicCode,
  SpanRecord,
  Tip,
  TurnMaskEntry,
  TurnMaskTableView as TurnMaskTable,
  Unmasker,
  UnmaskOptions,
  UnmaskStats,
  VerifyHit,
  VerifyReport,
} from './types.ts';
export { ORIGIN_KINDS, TIPS } from './types.ts';
export { createUnmasker, unmaskText } from './unmask/stream.ts';
export { stripTokens } from './unmask/strip.ts';
export { verifyMasked } from './verify.ts';
export { MASKER_VERSION } from './version.ts';
