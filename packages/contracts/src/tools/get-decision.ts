// get_decision (021 §4.4).
import { z } from 'zod';
import { DecisionSectionRole, SourceRef, type ToolContract } from './common.ts';

export const GetDecisionInput = z
  .object({
    ref: SourceRef.describe('Kaynak etiketi, ör. K3.'),
    section: z.number().int().min(1).nullable().describe('Bölüm no veya null.'),
    role: DecisionSectionRole.nullable().describe(
      'İstenen bölüm rolü (gerekce, hukum…) veya null.',
    ),
  })
  .strict();
export type GetDecisionInput = z.infer<typeof GetDecisionInput>;

export const getDecision: ToolContract<typeof GetDecisionInput> = {
  name: 'get_decision',
  description:
    'Arama sonucundaki kararın metnini rol etiketli bölümler hâlinde getirir (bölüm ≤ 6.000 karakter). section ve role null ise bölüm listesi ve ilk bölüm döner; gerekçe/hüküm için role ver.',
  inputSchema: GetDecisionInput,
  serverRules: () => null,
};
