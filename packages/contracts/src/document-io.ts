// Belge uçlarının editör yönünden sözleşmeleri (054 §4.1, §7.1, §7.4, §8.5, §9.2, §11.4).
// Uçların kendisi P17b'dedir; burada yalnız gövde ve yanıt şekilleri vardır.
import { z } from 'zod';
import { CONFIG_DEFAULTS } from './config/defaults.ts';
import { OP_RESULT_REASONS } from './edit-ops.ts';
import { BlockId, SectionRoleSchema, TipTapDoc, TipTapSection } from './editor-doc.ts';
import { KUNYE_STATUSES } from './enums.ts';

// ---------- Doğrulayıcı sorunları (054 §4.1–§4.3, §11.3) ----------

/**
 * `validateDoc`/`validateSection`/`toDocAst` sorun kodları. 054 §4'te adı verilenlere ek olarak
 * şema, sınır ve rol kuralı ihlallerinin ayrıntılı kodları.
 * `docast.forbidden_phrase` yalnız `toDocAst` hatasında kullanılır.
 */
export const EDITOR_ISSUE_CODES = [
  'schema.node_invalid',
  'schema.attr_invalid',
  'limit.block_count',
  'limit.draft_bytes',
  'text.forbidden_char',
  'text.tab_not_allowed',
  'blockId.missing',
  'blockId.duplicate',
  'citation.missing_id',
  'link.protocol',
  'list.nested',
  'table.limit',
  'table.merged_cell',
  'heading.not_first',
  'role.child_not_allowed',
  'role.count',
  'role.mark_not_allowed',
  'role.model_forbidden',
  'order.court_header_not_first',
  'order.signature_not_last',
  'role.duplicate',
  'section.empty',
  'placeholder.unfilled',
  'docast.forbidden_phrase',
] as const;
export type EditorIssueCode = (typeof EDITOR_ISSUE_CODES)[number];

/** `error` kaydı reddeder (422 `DOC_SCHEMA_INVALID`); `warning` engellemez (054 §4.1). */
export const EDITOR_ISSUE_SEVERITIES = ['error', 'warning'] as const;
export type EditorIssueSeverity = (typeof EDITOR_ISSUE_SEVERITIES)[number];

export const EditorIssue = z.object({
  code: z.enum(EDITOR_ISSUE_CODES),
  severity: z.enum(EDITOR_ISSUE_SEVERITIES),
  /** Sorunlu blok; belge geneli sorunlarda veya kimliksiz blokta `null`. */
  blockId: z.string().nullable(),
  /** Belge JSON'unda nokta ayrımlı yol (ör. `content.3.content.0`). */
  path: z.string(),
  /** Türkçe, kullanıcıya gösterilebilir; içerik metni taşımaz. */
  message: z.string(),
});
export type EditorIssueDto = z.infer<typeof EditorIssue>;

/** `checkElements` unsur kodları (054 §4.4, 080 §3.2, §4). */
export const ELEMENT_ISSUE_CODES = [
  'elements.courtHeader',
  'elements.partiesGrid',
  'elements.subjectLine',
  'elements.numberedExplanations',
  'elements.legalGrounds',
  'elements.evidenceList',
  'elements.resultAndRequest',
  'elements.attorneySignature',
  'elements.claimValue',
  'elements.fileNo',
  'elements.mediationRecord',
] as const;
export type ElementIssueCode = (typeof ELEMENT_ISSUE_CODES)[number];

/** Unsur uyarısı düzeyleri: `warn` (Z + boş) ve `info`; unsur eksikliği asla `block` değildir (080 §4). */
export const ELEMENT_ISSUE_SEVERITIES = ['warn', 'info'] as const;
export type ElementIssueSeverity = (typeof ELEMENT_ISSUE_SEVERITIES)[number];

export const ElementIssue = z.object({
  code: z.enum(ELEMENT_ISSUE_CODES),
  severity: z.enum(ELEMENT_ISSUE_SEVERITIES),
  blockId: z.string().nullable(),
  message: z.string(),
});
export type ElementIssueDto = z.infer<typeof ElementIssue>;

// ---------- Taslak kaydı (054 §9.2) ----------

export const DRAFT_SAVE_REASONS = [
  'autosave',
  'manual',
  'flush',
  'keepalive',
  'conflict_overwrite',
] as const;

export const DraftSaveRequest = z.object({
  /** Son bilinen `draftRev`. */
  baseVersion: z.number().int().min(0),
  draft: TipTapDoc,
  clientSeq: z.number().int().min(0),
  reason: z.enum(DRAFT_SAVE_REASONS),
});
export type DraftSaveRequestDto = z.infer<typeof DraftSaveRequest>;

export const CITATION_BLOCKING_LEVELS = ['none', 'soft', 'hard'] as const;

export const DraftSaveResponse = z.object({
  draftRev: z.number().int().min(0),
  savedAt: z.iso.datetime({ offset: true }),
  blockRevs: z.record(BlockId, z.number().int().min(0)),
  /** Yalnız bu yazımda açılan/değişen atıflar. */
  citations: z.array(
    z.object({
      citationId: z.uuid(),
      status: z.enum(KUNYE_STATUSES),
      blocking: z.enum(CITATION_BLOCKING_LEVELS),
      shortKunye: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  warnings: z.array(EditorIssue),
  versionCreated: z
    .object({ versionNo: z.number().int().min(1), trigger: z.literal('session_end') })
    .nullable(),
});
export type DraftSaveResponseDto = z.infer<typeof DraftSaveResponse>;

// ---------- Kabul ve ret (054 §7.1) ----------

const OpIds = z.array(z.string().min(1)).min(1);

export const AcceptRequest = z.object({
  /** `draftRev`. */
  baseVersion: z.number().int().min(0),
  /** `null` = bekleyen tüm op'lar. */
  opIds: OpIds.nullable(),
});
export type AcceptRequestDto = z.infer<typeof AcceptRequest>;

export const AcceptResponse = z.object({
  draftRev: z.number().int().min(1),
  version: z.object({ id: z.uuid(), versionNo: z.number().int().min(1) }),
  applied: z.array(z.string()),
  stale: z.array(z.string()),
  invalid: z.array(z.object({ opId: z.string(), reason: z.enum(OP_RESULT_REASONS) })),
  /** Sunucunun hesapladığı nihai düğümler (istemci yerelde `applyOps` çalıştırmaz). */
  changedBlocks: z.array(
    z.object({ blockId: BlockId, rev: z.number().int().min(1), node: TipTapSection }),
  ),
  removedBlockIds: z.array(BlockId),
  /** Nihai blok sırası. */
  order: z.array(BlockId),
  blockRevs: z.record(BlockId, z.number().int().min(0)),
});
export type AcceptResponseDto = z.infer<typeof AcceptResponse>;

export const RejectRequest = z.object({ opIds: OpIds.nullable() });
export type RejectRequestDto = z.infer<typeof RejectRequest>;

// ---------- Kullanıcı başlatmalı öneri (054 §7.4) ----------

export const SUGGESTION_INTENTS = [
  'rewrite',
  'shorten',
  'formalize',
  'refresh_from_records',
] as const;
export type SuggestionIntent = (typeof SUGGESTION_INTENTS)[number];

export const SuggestionRequest = z.discriminatedUnion('intent', [
  z.object({
    intent: z.enum(['rewrite', 'shorten', 'formalize']),
    baseVersion: z.number().int(),
    blockId: BlockId,
    blockRev: z.number().int(),
    selection: z.object({
      text: z.string().min(1).max(CONFIG_DEFAULTS['editor.selectionMaxChars']),
      occurrence: z.number().int().min(1),
    }),
    note: z.string().max(500).nullable(),
  }),
  z.object({
    intent: z.literal('refresh_from_records'),
    baseVersion: z.number().int(),
    role: z.enum(['partiesGrid', 'attorneySignature']),
    /** `replace`: hedef blok; `insert_after`: yerleştirileceği blokun öncesi. */
    blockId: BlockId,
    mode: z.enum(['replace', 'insert_after']),
  }),
]);
export type SuggestionRequestDto = z.infer<typeof SuggestionRequest>;

// ---------- Sürüm farkı (054 §8.5) ----------

export const BLOCK_CHANGE_KINDS = ['added', 'removed', 'modified', 'moved'] as const;
export type BlockChangeKind = (typeof BLOCK_CHANGE_KINDS)[number];

const DiffSide = z.object({
  /** `null` = taslak. */
  versionNo: z.number().int().min(1).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const VersionDiffResponse = z.object({
  from: DiffSide,
  to: DiffSide,
  /** Yalnız değişen bloklar, `to` sırasına göre (`removed` olanlar `from` konumlarında). */
  blocks: z.array(
    z.object({
      blockId: BlockId,
      role: SectionRoleSchema,
      change: z.enum(BLOCK_CHANGE_KINDS),
      /** Yalnız `moved`: 0 tabanlı sıra. */
      fromIndex: z.number().int().min(0).optional(),
      toIndex: z.number().int().min(0).optional(),
      before: TipTapSection.optional(),
      after: TipTapSection.optional(),
    }),
  ),
  unchangedCount: z.number().int().min(0),
});
export type VersionDiffResponseDto = z.infer<typeof VersionDiffResponse>;

// ---------- İçe aktarma raporu (054 §11.4) ----------

export const ImportReport = z.object({
  recognizedRoles: z.array(z.object({ role: SectionRoleSchema, blockId: BlockId })),
  freeSectionCount: z.number().int().min(0),
  hiddenContentSkipped: z.number().int().min(0),
  droppedFeatures: z.array(z.object({ feature: z.string(), count: z.number().int().min(1) })),
  citationCandidates: z.number().int().min(0),
  warnings: z.array(z.string()),
});
export type ImportReportDto = z.infer<typeof ImportReport>;
