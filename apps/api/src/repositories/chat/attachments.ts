// Sohbet eki sorguları (P21 K3; ilk dilim). RLS altında: inbox evrakını yalnız yükleyen görür
// (`files_select`); başka kullanıcının/büronun eki satır döndürmez.
import type { TenantTx } from '@eda/db';

export interface AttachmentRow {
  readonly id: string;
  readonly origin: string;
  readonly originId: string | null;
  readonly caseId: string | null;
  readonly uploadedBy: string | null;
  readonly status: string;
  readonly statusReason: string | null;
  readonly fileType: string;
  readonly mimeType: string;
  readonly name: string;
  readonly deleteRequestedAt: Date | null;
  readonly scannedAt: Date | null;
  readonly text: string | null;
  readonly pageCount: number | null;
  readonly pageOffsets: readonly number[];
  readonly createdAt: Date;
}

/**
 * K3: henüz bir sohbete bağlı olmayan kendi sohbet eklerini bu sohbete bağlar (aynı işlemde). Başka
 * sohbete bağlı ek DEĞİŞMEZ; çağıran satırı okuyup reddeder.
 */
export async function bindAttachments(
  tx: TenantTx,
  orgId: string,
  userId: string,
  conversationId: string,
  ids: readonly string[],
): Promise<void> {
  await tx.query(
    `UPDATE app.files SET origin_id = $3
      WHERE org_id = $1 AND id = ANY($4::uuid[]) AND origin = 'chat_attachment' AND case_id IS NULL
        AND uploaded_by = $2 AND origin_id IS NULL AND delete_requested_at IS NULL`,
    [orgId, userId, conversationId, ids],
  );
}

export async function loadAttachments(
  tx: TenantTx,
  orgId: string,
  ids: readonly string[],
): Promise<AttachmentRow[]> {
  const r = await tx.query(
    `SELECT f.id, f.origin, f.origin_id, f.case_id, f.uploaded_by, f.status, f.status_reason,
            f.file_type, f.mime_type, f.original_name, f.delete_requested_at, f.scanned_at,
            f.created_at, t.text, COALESCE(t.page_count, f.page_count) AS page_count, t.page_offsets
       FROM app.files f
       LEFT JOIN app.file_texts t ON t.file_id = f.id AND t.org_id = f.org_id
      WHERE f.org_id = $1 AND f.id = ANY($2::uuid[])`,
    [orgId, ids],
  );
  const date = (v: unknown): Date | null =>
    v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
  return (r.rows as Record<string, unknown>[]).map((x) => ({
    id: String(x.id),
    origin: String(x.origin),
    originId: x.origin_id === null ? null : String(x.origin_id),
    caseId: x.case_id === null ? null : String(x.case_id),
    uploadedBy: x.uploaded_by === null ? null : String(x.uploaded_by),
    status: String(x.status),
    statusReason: x.status_reason === null ? null : String(x.status_reason),
    fileType: String(x.file_type),
    mimeType: String(x.mime_type),
    name: String(x.original_name),
    deleteRequestedAt: date(x.delete_requested_at),
    scannedAt: date(x.scanned_at),
    text: typeof x.text === 'string' ? x.text : null,
    pageCount: x.page_count === null || x.page_count === undefined ? null : Number(x.page_count),
    pageOffsets: Array.isArray(x.page_offsets) ? x.page_offsets.map(Number) : [],
    createdAt: date(x.created_at) ?? new Date(0),
  }));
}
