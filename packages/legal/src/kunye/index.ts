export {
  ARTICLE_KEY_PREFIXES,
  type ArticleKeyParts,
  type ArticleKeyPrefix,
  type ArticleSpan,
  articleHeadingText,
  articleKeyText,
  articleSpanText,
  normalizeArticleKey,
  parseArticleKey,
  parseArticleSpan,
} from './article-key.ts';
export {
  articleOccurrences,
  CITED_ARTICLES_MAX,
  extractArticleRefs,
} from './articles-basic.ts';
export {
  type CanonNo,
  type CaseNoWarning,
  canonicalizeCaseNo,
  DECISION_DATE_MIN,
  formatDateTr,
  isoDate,
  isPlausibleDecisionDate,
  type ParsedCaseNoText,
  parseCaseNo,
  parseCaseNoText,
  parseDateTr,
} from './canonical.ts';
export { CHAMBER_RANGES, chamberInfo, isKnownChamber } from './chambers.ts';
export {
  type ExtractOptions,
  type ExtractResult,
  extractAll,
  extractArticleCitations,
} from './extract.ts';
export {
  COURT_CLASS_BY_TYPE,
  courtClassOf,
  type FormattedKunye,
  formatArticleRef,
  formatKunye,
  formatSourceLine,
  type KunyeRecord,
  type KunyeStyle,
} from './format.ts';
export { type KunyeHashFields, kunyeHashInput, kunyeUnitKey } from './hash.ts';
export { LAW_ALIASES, type LawAlias, lawByAbbr, lawByNo, lawDisplay } from './law-aliases.ts';
export {
  LAW_REGISTRY,
  type LawRegistryEntry,
  type LawRegistryGroup,
  type LawTypeMapping,
  lawTypeToDb,
  registryEntry,
} from './law-registry.ts';
export { inferLawNosFromQuery } from './law-topics.ts';
export type { ArticleCitationExtractor, CitedArticleRef } from './ports.ts';
export {
  type AttributedQuote,
  attributeQuote,
  type ExtractedQuote,
  extractAttributedQuotes,
  extractQuotes,
  matchQuote,
  type QuoteMatch,
  type QuoteSpan,
  quoteCmpNorm,
} from './quote.ts';
export {
  type ArticleReference,
  type DecisionReference,
  parseArticleReferences,
  parseDecisionReferences,
} from './reference.ts';
export {
  type ArticleRef,
  COURT_CLASSES,
  type CourtClass,
  type ExcludedCitation,
  type Impossible,
  OUT_OF_COVERAGE_CLASSES,
  type ParsedArticle,
  type ParsedCitation,
  type ParsedKunye,
} from './types.ts';
