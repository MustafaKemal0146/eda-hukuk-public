// Belge ve şablon uçlarının DTO'ları (041 §2.3; 054 §8, §9; P17b). Taslak kaydı ve sürüm farkı
// yanıtları `document-io.ts`tedir (`DraftSaveRequest/Response`, `VersionDiffResponse`).
// İçerik (`draft`, sürüm `content`) yalnız `DocumentDto` ve sürüm okuma yanıtında döner; liste ve
// meta yanıtları içerik taşımaz.
import { z } from 'zod';
import { EditOpSchema, OpStatus } from '../edit-ops.ts';
import { TipTapDoc } from '../editor-doc.ts';
import {
  DOCUMENT_GENERATION_STATUSES,
  DOCUMENT_KINDS,
  DOCUMENT_STATUSES,
  DOCUMENT_SUBTYPES,
  DOCUMENT_VERSION_SOURCES,
  DOCUMENT_VERSION_TRIGGERS,
  KUNYE_STATUSES,
} from '../enums.ts';
import { DocumentOutline } from '../stream/data-parts.ts';

const IsoDateTime = z.iso.datetime({ offset: true });

export const DOCUMENT_TITLE_MAX = 200;
/** Sürüm adı üst sınırı (054 §8.2; P17b.7). */
export const VERSION_NAME_MAX = 80;
export const DOCUMENT_LIST_SORTS = ['updated_desc', 'created_desc', 'title_asc'] as const;
export const DOCUMENT_PAGE_SIZE_DEFAULT = 25;
export const DOCUMENT_PAGE_SIZE_MAX = 100;

export const DocumentKindDto = z.enum(DOCUMENT_KINDS);
export const DocumentStatusDto = z.enum(DOCUMENT_STATUSES);
export const DocumentSubtypeDto = z.enum(DOCUMENT_SUBTYPES);

export const DocumentListDto = z.object({
  id: z.uuid(),
  kind: DocumentKindDto,
  subtype: DocumentSubtypeDto.nullable(),
  status: DocumentStatusDto,
  title: z.string(),
  caseId: z.uuid().nullable(),
  ownerId: z.uuid(),
  draftRev: z.number().int().min(0),
  generationStatus: z.enum(DOCUMENT_GENERATION_STATUSES),
  lastExportedAt: IsoDateTime.nullable(),
  updatedAt: IsoDateTime,
  createdAt: IsoDateTime,
});
export type DocumentListDtoValue = z.infer<typeof DocumentListDto>;

export const DocumentListResponse = z.object({
  items: z.array(DocumentListDto),
  nextCursor: z.string().nullable(),
});
export type DocumentListResponseValue = z.infer<typeof DocumentListResponse>;

export const SuggestionDto = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  baseRev: z.number().int().min(0),
  ops: z.array(EditOpSchema),
  status: OpStatus,
  conversationId: z.uuid().nullable(),
  messageId: z.uuid().nullable(),
  requestedBy: z.uuid().nullable(),
  resolvedBy: z.uuid().nullable(),
  resolvedAt: IsoDateTime.nullable(),
  resultingVersionId: z.uuid().nullable(),
  createdAt: IsoDateTime,
});
export type SuggestionDtoValue = z.infer<typeof SuggestionDto>;

export const DocumentDto = DocumentListDto.extend({
  sourceConversationId: z.uuid().nullable(),
  respondsToFileId: z.uuid().nullable(),
  templateId: z.uuid().nullable(),
  draft: TipTapDoc,
  draftSavedAt: IsoDateTime.nullable(),
  outline: DocumentOutline.nullable(),
  approvedAt: IsoDateTime.nullable(),
  filedDeclaredAt: IsoDateTime.nullable(),
  citations: z.object({
    total: z.number().int().min(0),
    byStatus: z.record(z.enum(KUNYE_STATUSES), z.number().int().min(0)),
  }),
  pendingSuggestionCount: z.number().int().min(0),
  /** P17b'de daima boş (öneri hattı P18). */
  suggestions: z.array(SuggestionDto),
});
export type DocumentDtoValue = z.infer<typeof DocumentDto>;

export const CreateDocumentInput = z.strictObject({
  kind: DocumentKindDto,
  title: z.string().trim().min(1).max(DOCUMENT_TITLE_MAX),
  caseId: z.uuid().optional(),
  subtype: DocumentSubtypeDto.optional(),
  templateId: z.uuid().optional(),
});
export type CreateDocumentInputValue = z.infer<typeof CreateDocumentInput>;

export const PatchDocumentInput = z
  .strictObject({
    title: z.string().trim().min(1).max(DOCUMENT_TITLE_MAX).optional(),
    status: DocumentStatusDto.optional(),
    /** `filed_declared` için kullanıcı beyanı onayı (UYAP kaydı ima etmez). */
    confirm: z.boolean().optional(),
  })
  .refine((v) => v.title !== undefined || v.status !== undefined, { message: 'empty_patch' });
export type PatchDocumentInputValue = z.infer<typeof PatchDocumentInput>;

export const ListDocumentsQuery = z.strictObject({
  kind: DocumentKindDto.optional(),
  status: DocumentStatusDto.optional(),
  caseId: z.uuid().optional(),
  sort: z.enum(DOCUMENT_LIST_SORTS).default('updated_desc'),
  cursor: z.string().min(1).max(400).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DOCUMENT_PAGE_SIZE_MAX)
    .default(DOCUMENT_PAGE_SIZE_DEFAULT),
});
export type ListDocumentsQueryValue = z.infer<typeof ListDocumentsQuery>;

export const DocumentVersionDto = z.object({
  id: z.uuid(),
  versionNo: z.number().int().min(1),
  source: z.enum(DOCUMENT_VERSION_SOURCES),
  trigger: z.enum(DOCUMENT_VERSION_TRIGGERS),
  name: z.string().nullable(),
  baseDraftRev: z.number().int().min(0),
  createdBy: z.uuid().nullable(),
  createdAt: IsoDateTime,
});
export type DocumentVersionDtoValue = z.infer<typeof DocumentVersionDto>;

/** Tek sürüm okuma: meta + içerik (`GET …/versions/:versionId`). */
export const DocumentVersionContentDto = DocumentVersionDto.extend({ content: TipTapDoc });

export const DocumentVersionListResponse = z.object({
  items: z.array(DocumentVersionDto),
  nextCursor: z.string().nullable(),
});

export const CreateVersionInput = z.strictObject({
  name: z.string().trim().min(1).max(VERSION_NAME_MAX).optional(),
});
export type CreateVersionInputValue = z.infer<typeof CreateVersionInput>;

export const ListVersionsQuery = z.strictObject({
  cursor: z.string().min(1).max(400).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(DOCUMENT_PAGE_SIZE_MAX)
    .default(DOCUMENT_PAGE_SIZE_DEFAULT),
});
export type ListVersionsQueryValue = z.infer<typeof ListVersionsQuery>;

/** `from`/`to`: sürüm kimliği veya `draft`. */
export const DiffQuery = z.strictObject({
  from: z.union([z.literal('draft'), z.uuid()]),
  to: z.union([z.literal('draft'), z.uuid()]),
});
export type DiffQueryValue = z.infer<typeof DiffQuery>;

export const RestoreVersionResponse = z.object({
  draftRev: z.number().int().min(1),
  version: DocumentVersionDto,
  blockRevs: z.record(z.string(), z.number().int().min(0)),
});
export type RestoreVersionResponseValue = z.infer<typeof RestoreVersionResponse>;

export const TemplateDto = z.object({
  id: z.uuid(),
  orgId: z.uuid().nullable(),
  kind: DocumentKindDto,
  subtype: DocumentSubtypeDto.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  caseTypeCode: z.string().nullable(),
  version: z.number().int().min(1),
  isActive: z.boolean(),
  updatedAt: IsoDateTime,
});
export type TemplateDtoValue = z.infer<typeof TemplateDto>;

export const TemplateListResponse = z.object({ items: z.array(TemplateDto) });
export const ListTemplatesQuery = z.strictObject({
  kind: DocumentKindDto.optional(),
  subtype: DocumentSubtypeDto.optional(),
});
