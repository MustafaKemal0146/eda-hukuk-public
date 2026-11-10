// Süre motoru (083; P22 KA). Saf ve deterministik: saat, ağ, DB okumaz; kural, tatil verisi ve
// yapılandırma parametre gelir. Süreyi yalnız bu motor hesaplar; LLM hesaplamaz (Y-09).

// Tarih aralığı yardımcıları (seed eşlemesi; P03c).
export { type DateRange, toDateRangeLiteral } from '../catalog-common.ts';
export {
  calculateDeadline,
  type DeadlineCalcFailure,
  type DeadlineCalcResult,
  type DeadlineEngineContext,
  type DeadlineEngineInput,
  ENGINE_VERSION,
  EVENT_DATE_MAX,
  EVENT_DATE_MIN,
  isRuleSelectable,
  MAX_CHAIN_ROUNDS,
} from './calculate.ts';
export { buildCalendarIndex, type CalendarIndex, type SaturdayPolicy } from './calendar.ts';
export {
  addDays,
  addMonths,
  addPeriod,
  type CivilDay,
  formatTr,
  fromIso,
  isValidIso,
  parseTr,
  toIso,
  weekday,
  weekdayName,
} from './civil-date.ts';
export {
  CATALOG_EFFECTIVE_FROM,
  CATALOG_NOTE_PREFIX,
  catalogNotes,
  catalogParams,
  catalogRuleRecord,
  DEADLINE_RULE_CATALOG,
  type DeadlineRuleCatalogEntry,
  RULE_CONFIDENCE_LEVELS,
  type RuleConfidenceLevel,
} from './data/rule-catalog.ts';
export { canonicalJson, DEADLINE_TIME_ZONE, toIstanbulIso } from './format.ts';
export {
  checkDeadlineText,
  compareWithCalculations,
  type DeadlineCheck,
  type DeadlineExpression,
  extractDeadlineExpressions,
  LOCK_CONTEXT_WORDS,
  LOCK_EXCLUSION_WORDS,
  type LockCalculation,
} from './lock.ts';
export {
  DeadlineEngineError,
  type DeadlineEngineErrorCode,
  DeadlineRuleParams,
  type DeadlineRuleParamsValue,
  DeadlineRuleRecord,
  type DeadlineRuleRecordValue,
  PROFILE_IDS,
  PROFILES,
  type ProfileId,
  parseDeadlineRule,
} from './params.ts';
export {
  ALIAS_SCORE_CONTAINS,
  ALIAS_SCORE_EXACT,
  aliasScore,
  candidatesForDocType,
  DOC_TYPE_RULE_CANDIDATES,
  type RuleMatch,
  resolveRuleByAlias,
} from './rule-match.ts';
