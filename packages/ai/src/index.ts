// @eda/ai dış yüzeyi (020 §1): gateway, araç çalışma zamanı ve istem kurucu.
export { AiCatalog, ModelRow, ProviderRow } from './gateway/catalog.ts';
export { classOf, type DataClass, decide, type GateEnv, type GateInput } from './gateway/gate.ts';
export {
  createGateway,
  type Gateway,
  GatewayDenied,
  type GatewayOptions,
  type TurnBadge,
} from './gateway/gateway.ts';
export {
  KVKK_MASKING_FAILED,
  type MaskedTurn,
  type MaskerPort,
  MaskingDenied,
  NullMasker,
} from './middleware/masking.ts';
export {
  createKvkkMasker,
  type DictionaryProvider,
  EMPTY_DICTIONARY,
  KvkkMasker,
  type KvkkMaskerOptions,
} from './middleware/masking-kvkk.ts';
export {
  type AttachmentBlock,
  type AttachmentInput,
  buildAttachmentBlock,
  buildFollowupBlock,
} from './prompts/attachments.ts';
export {
  chatInstructions,
  istanbulToday,
  render,
  sourceIndex,
  turnFrame,
} from './prompts/build.ts';
export { referenceHints } from './prompts/reference-hints.ts';
export { loadBundledFixture } from './providers/fixtures.ts';
export { MockFixture, pickScenario } from './providers/mock.ts';
export {
  type DecisionDoc,
  type DecisionHit,
  type LawArticles,
  type LawHit,
  MemoryRefStore,
  type QuoteText,
  type QuoteTextMemory,
  type RefStore,
  rememberQuoteText,
  type SourceBackend,
  SourceError,
  type SourceErrorCode,
  type SourceRecord,
  type ToolContext,
  type ToolEvent,
} from './tools/context.ts';
export { buildToolSet, newTurnBudget, type ToolOutput } from './tools/execute.ts';
// Karar Arşivi ekranı da künyeyi aynı biçimleyiciden alır.
export { decisionLongKunye, decisionShortKunye } from './tools/kunye.ts';
export {
  checkCitationQuotes,
  type QuoteCheckInput,
  type QuoteCheckResult,
} from './tools/quote-check.ts';
