// Bölümleme: karar bölümleyici (034 §6, P11 K1), mevzuat madde / fıkra ayrıştırıcı (034 §9.3, P11 K2),
// parçalayıcı ve gömme girdisi (034 §7, P14a).
export {
  type ChunkLimits,
  type CountTokens,
  chunkLawArticle,
  chunkSection,
  DEFAULT_CHUNK_LIMITS,
  type LawArticleChunkInput,
  type SectionChunk,
} from './chunker.ts';
export {
  type DecisionSection,
  type NumberedSection,
  roleOfLine,
  type SectionedDecision,
  type SectionOutcome,
  sectionDecision,
  sectionProfileOf,
  splitDecisionSections,
  splitLongText,
} from './decision-sections.ts';
export {
  type ArticleCitation,
  buildContextPrefix,
  buildEmbedInput,
  buildLawContextPrefix,
  contextPrefixCandidates,
  formatPrefixCitations,
  type LawPrefixInput,
  type PrefixDecision,
  ROLE_PREFIX_LABELS,
  selectPrefixCitations,
} from './embed-input.ts';
export {
  type LawArticleKind,
  type LawParagraph,
  type ParsedLawArticle,
  parseLawArticles,
  splitParagraphs,
} from './law-articles.ts';
export {
  GEREKCE_TAIL,
  PROFILE_MARKERS,
  SECTION_MARKERS,
  type SectionMarker,
  type SectionProfile,
} from './patterns.ts';
