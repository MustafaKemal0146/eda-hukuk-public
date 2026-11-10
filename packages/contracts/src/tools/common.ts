// Araç ortak tipleri (021 §4.2): modele giden strict alt küme. Tarihler GG.AA.YYYY; iç sözleşmeler ISO.
import { z } from 'zod';
import {
  DEADLINE_BRANCHES,
  DEADLINE_START_EVENTS,
  DECISION_SECTION_ROLES,
  DOCUMENT_KINDS,
  FILE_DOC_TYPES,
  SECTION_ROLES,
  SERVICE_METHODS,
  SOURCE_CODES,
} from '../enums.ts';

/** MCP/LLM mahkeme türleri: 002 §11 `corpus.*.court_type` kümesinin ilk 8 değeri (021 §4.2, §5.6). */
export const COURT_TYPES = [
  'yargitay',
  'danistay',
  'istinaf_hukuk',
  'ilk_derece_hukuk',
  'kyb',
  'aym_norm',
  'aym_bireysel',
  'uyusmazlik',
] as const;
export type CourtType = (typeof COURT_TYPES)[number];

export const TrDate = z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/);
export const SourceRef = z.string().regex(/^K\d{1,4}$/);
export const EsasNo = z.string().regex(/^\d{4}\/\d{1,7}$/);
export const LawNo = z.string().regex(/^\d{1,5}$/);
export const IsoDate = z.iso.date();
export const CourtTypeSchema = z.enum(COURT_TYPES);
export const DecisionSectionRole = z.enum(DECISION_SECTION_ROLES);
export const SectionRole = z.enum(SECTION_ROLES);
export const FileDocType = z.enum(FILE_DOC_TYPES);
export const DocumentKind = z.enum(DOCUMENT_KINDS);
export const DeadlineBranch = z.enum(DEADLINE_BRANCHES);
export const StartEvent = z.enum(DEADLINE_START_EVENTS);
export const ServiceMethod = z.enum(SERVICE_METHODS);
export const SourceCode = z.enum(SOURCE_CODES);

/** Araç sözleşmesi: modele giden kilitli şema + yalnız sunucuda uygulanan kurallar (021 §4.1). */
export type ToolContract<S extends z.ZodType = z.ZodType> = {
  name: string;
  description: string;
  inputSchema: S;
  serverRules: (input: z.infer<S>) => string | null;
};
