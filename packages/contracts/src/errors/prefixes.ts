// Hata kodu önekleri: kapalı küme, 23 önek (044 §2.2, 002 §20). Yeni önek yalnız 002'de eklenir.

export const ERROR_PREFIXES = [
  'AUTH_',
  'ORG_',
  'SEAT_',
  'CASE_',
  'FILE_',
  'CHAT_',
  'LLM_',
  'AI_POLICY_',
  'TOOL_',
  'SOURCE_',
  'DOC_',
  'EXPORT_',
  'CITATION_',
  'CAL_',
  'DEADLINE_',
  'BILLING_',
  'QUOTA_',
  'PARTNER_',
  'ADMIN_',
  'KVKK_',
  'VALIDATION_',
  'RATE_',
  'INTERNAL_',
] as const;

export type ErrorPrefix = (typeof ERROR_PREFIXES)[number];

// Uzundan kısaya sıralı kopya: en uzun eşleşme önce denenir (`AI_POLICY_` bir `AI_` öneki sayılmaz).
const BY_LENGTH: readonly ErrorPrefix[] = [...ERROR_PREFIXES].sort((a, b) => b.length - a.length);

/** Kodun önekini en uzun eşleşmeyle çözer; kapalı kümede eşleşme yoksa `null`. */
export function prefixOf(code: string): ErrorPrefix | null {
  for (const prefix of BY_LENGTH) {
    if (code.startsWith(prefix) && code.length > prefix.length) return prefix;
  }
  return null;
}
