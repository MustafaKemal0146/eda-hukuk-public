// Kalıcı öneri op şeması (054 §6.1; 030 §8, 041 `EditOp`). camelCase; RFC 6902 KULLANILMAZ.
// `find`, `replace` ve `content` maskesiz gerçek metindir: loglanmaz (002 §23).
import { z } from 'zod';
import { BlockId, SectionRoleSchema, TipTapSection } from './editor-doc.ts';
import { SUGGESTION_OP_STATUSES } from './enums.ts';

/** Bir önerideki en çok op (021 `ops` 1–20). */
export const EDIT_OPS_MAX = 20;
/** Op başına en çok atıf kimliği (054 §6.1). */
export const EDIT_OP_CITATIONS_MAX = 20;

export const OpStatus = z.enum(SUGGESTION_OP_STATUSES);

const OpBase = {
  opId: z.string().min(1),
  blockId: BlockId,
  /** Op üretildiği andaki hedef blok `rev`'i (öneri tabanı). */
  blockRev: z.number().int().min(1),
  reason: z.string().max(300),
  citationIds: z.array(z.uuid()).max(EDIT_OP_CITATIONS_MAX),
  opStatus: OpStatus,
};

export const EditOpSchema = z.discriminatedUnion('type', [
  z.object({ ...OpBase, type: z.literal('replace_block'), content: TipTapSection }),
  z.object({
    ...OpBase,
    type: z.literal('insert_after'),
    role: SectionRoleSchema,
    content: TipTapSection,
  }),
  z.object({ ...OpBase, type: z.literal('delete_block') }),
  z.object({
    ...OpBase,
    type: z.literal('replace_text'),
    find: z.string().min(1).max(2000),
    replace: z.string().max(8000),
    occurrence: z.number().int().min(1),
  }),
]);
export type EditOp = z.infer<typeof EditOpSchema>;

/** `applyOps` op sonucu nedenleri (054 §6.2). */
export const OP_RESULT_REASONS = [
  'block_missing',
  'rev_mismatch',
  'protected_role',
  'text_not_found',
  'occurrence_out_of_range',
  'crosses_citation',
  'crosses_paragraph',
  'role_mismatch',
  'schema_invalid',
  'conflicting_ops',
] as const;
export type OpResultReason = (typeof OP_RESULT_REASONS)[number];
