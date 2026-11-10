// Belge depo satır tipleri ve eşleyicileri (030 §8). İçerik kolonları (`draft`, `outline`, sürüm
// `content`) yalnız bu katmandan servise taşınır; log/span/kuyruk yüküne yazılmaz.
import type {
  DocumentGenerationStatus,
  DocumentKind,
  DocumentStatus,
  DocumentSubtype,
  DocumentVersionSource,
  DocumentVersionTrigger,
} from '@eda/contracts/enums';

export interface DocumentRow {
  readonly id: string;
  readonly orgId: string;
  readonly ownerId: string;
  readonly caseId: string | null;
  readonly sourceConversationId: string | null;
  readonly respondsToFileId: string | null;
  readonly templateId: string | null;
  readonly kind: DocumentKind;
  readonly subtype: DocumentSubtype | null;
  readonly status: DocumentStatus;
  readonly title: string;
  readonly draft: unknown;
  /** `bigint` kolon; pg dize çevirir, burada sayıya indirgenir (2^53 altı). */
  readonly draftRev: number;
  readonly draftSavedAt: Date | null;
  readonly outline: unknown | null;
  readonly generationStatus: DocumentGenerationStatus;
  readonly approvedAt: Date | null;
  readonly filedDeclaredAt: Date | null;
  readonly lastExportedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Oturum sınırı geçti mi (`draft_saved_at <= now() - editor.versionSessionMin`; DB saati). */
  readonly sessionExpired: boolean;
}

export type DocumentListRow = Omit<DocumentRow, 'draft' | 'outline' | 'sessionExpired'>;

export interface VersionRow {
  readonly id: string;
  readonly versionNo: number;
  readonly source: DocumentVersionSource;
  readonly trigger: DocumentVersionTrigger;
  readonly name: string | null;
  readonly baseDraftRev: number;
  readonly createdBy: string | null;
  readonly createdAt: Date;
}

export type VersionContentRow = VersionRow & { readonly content: unknown };

export interface TemplateRow {
  readonly id: string;
  readonly orgId: string | null;
  readonly kind: DocumentKind;
  readonly subtype: DocumentSubtype | null;
  readonly title: string;
  readonly description: string | null;
  readonly caseTypeCode: string | null;
  readonly version: number;
  readonly isActive: boolean;
  readonly updatedAt: Date;
}

type Raw = Record<string, unknown>;

export function documentFromRow(r: Raw): DocumentRow {
  return {
    ...documentListFromRow(r),
    draft: r.draft,
    outline: r.outline ?? null,
    sessionExpired: r.session_expired === true,
  };
}

export function documentListFromRow(r: Raw): DocumentListRow {
  return {
    id: r.id as string,
    orgId: r.org_id as string,
    ownerId: r.owner_id as string,
    caseId: (r.case_id as string | null) ?? null,
    sourceConversationId: (r.source_conversation_id as string | null) ?? null,
    respondsToFileId: (r.responds_to_file_id as string | null) ?? null,
    templateId: (r.template_id as string | null) ?? null,
    kind: r.kind as DocumentKind,
    subtype: (r.subtype as DocumentSubtype | null) ?? null,
    status: r.status as DocumentStatus,
    title: r.title as string,
    draftRev: Number(r.draft_rev),
    draftSavedAt: (r.draft_saved_at as Date | null) ?? null,
    generationStatus: r.generation_status as DocumentGenerationStatus,
    approvedAt: (r.approved_at as Date | null) ?? null,
    filedDeclaredAt: (r.filed_declared_at as Date | null) ?? null,
    lastExportedAt: (r.last_exported_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
  };
}

export function versionFromRow(r: Raw): VersionRow {
  return {
    id: r.id as string,
    versionNo: Number(r.version_no),
    source: r.source as DocumentVersionSource,
    trigger: r.trigger as DocumentVersionTrigger,
    name: (r.name as string | null) ?? null,
    baseDraftRev: Number(r.base_draft_rev),
    createdBy: (r.created_by as string | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

export function templateFromRow(r: Raw): TemplateRow {
  return {
    id: r.id as string,
    orgId: (r.org_id as string | null) ?? null,
    kind: r.kind as DocumentKind,
    subtype: (r.subtype as DocumentSubtype | null) ?? null,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    caseTypeCode: (r.case_type_code as string | null) ?? null,
    version: Number(r.version),
    isActive: r.is_active === true,
    updatedAt: r.updated_at as Date,
  };
}
