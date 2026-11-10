// @eda/contracts/tools: LLM'in gördüğü 9 araç (002 §13.1 sırası; bağlama göre süzme YOK).
import { calculateDeadline } from './calculate-deadline.ts';
import type { ToolContract } from './common.ts';
import { createDocument } from './create-document.ts';
import { editDocument } from './edit-document.ts';
import { getDecision } from './get-decision.ts';
import { getLegislationArticle } from './get-legislation-article.ts';
import { searchCaseFiles } from './search-case-files.ts';
import { searchDecisions } from './search-decisions.ts';
import { searchLegislation } from './search-legislation.ts';
import { submitOutline } from './submit-outline.ts';

export const LLM_TOOLS = [
  searchDecisions,
  getDecision,
  searchLegislation,
  getLegislationArticle,
  searchCaseFiles,
  calculateDeadline,
  createDocument,
  editDocument,
  submitOutline,
] as const satisfies readonly ToolContract[];

export const LLM_TOOL_NAMES = LLM_TOOLS.map((t) => t.name);
export type LlmToolName =
  | 'search_decisions'
  | 'get_decision'
  | 'search_legislation'
  | 'get_legislation_article'
  | 'search_case_files'
  | 'calculate_deadline'
  | 'create_document'
  | 'edit_document'
  | 'submit_outline';

export {
  COURT_TYPES,
  type CourtType,
  EsasNo,
  IsoDate,
  LawNo,
  SourceRef,
  type ToolContract,
  TrDate,
} from './common.ts';
export { GetDecisionInput } from './get-decision.ts';
export { GetLegislationArticleInput } from './get-legislation-article.ts';
export { SearchDecisionsInput } from './search-decisions.ts';
export { SearchLegislationInput } from './search-legislation.ts';
