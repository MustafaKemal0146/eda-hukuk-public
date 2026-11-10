// `app.files`, `app.custody_events` deposu (030 §6, 033). Her fonksiyon çağıranın `withTenant`
// işlemini alır; görünürlük (dava erişimi / inbox sahibi) RLS'dedir. SQL yalnız burada. Anahtar
// malzemesi (`wrapped_file_key`, sürümler, nesne anahtarı) yalnız `*Keyed` okumalarında döner;
// DTO üretiminde kullanılmaz.
import type { TenantTx } from '@eda/db';

export interface FileRow {
  readonly id: string;
  readonly caseId: string | null;
  readonly origin: string;
  readonly originalName: string;
  readonly fileType: string;
  readonly sizeBytes: number;
  readonly sha256: Buffer;
  readonly status: string;
  readonly statusReason: string | null;
  readonly scannedAt: Date | null;
  readonly pageCount: number | null;
  readonly hasSearchable: boolean;
  readonly hasClean: boolean;
  readonly progressDone: number | null;
  readonly progressTotal: number | null;
  readonly uploadedBy: string | null;
  readonly deleteRequestedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FileKeyed extends FileRow {
  readonly objectKey: string;
  readonly mimeType: string;
  readonly keyVersion: number;
  readonly wrapDekVersion: number;
  readonly wrappedFileKey: Buffer;
}

const COLS = `id, case_id, origin, original_name, file_type, size_bytes, sha256, status, status_reason,
  scanned_at, page_count, has_searchable, has_clean, progress_done, progress_total, uploaded_by,
  delete_requested_at, created_at, updated_at`;
const KEYED_COLS = `${COLS}, object_key, mime_type, key_version, wrap_dek_version, wrapped_file_key`;

const d = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dn = (v: unknown): Date | null => (v === null || v === undefined ? null : d(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function rowOf(r: Record<string, unknown>): FileRow {
  return {
    id: String(r.id),
    caseId: s(r.case_id),
    origin: String(r.origin),
    originalName: String(r.original_name),
    fileType: String(r.file_type),
    sizeBytes: Number(r.size_bytes),
    sha256: r.sha256 as Buffer,
    status: String(r.status),
    statusReason: s(r.status_reason),
    scannedAt: dn(r.scanned_at),
    pageCount: n(r.page_count),
    hasSearchable: r.has_searchable === true,
    hasClean: r.has_clean === true,
    progressDone: n(r.progress_done),
    progressTotal: n(r.progress_total),
    uploadedBy: s(r.uploaded_by),
    deleteRequestedAt: dn(r.delete_requested_at),
    createdAt: d(r.created_at),
    updatedAt: d(r.updated_at),
  };
}

function keyedOf(r: Record<string, unknown>): FileKeyed {
  return {
    ...rowOf(r),
    objectKey: String(r.object_key),
    mimeType: String(r.mime_type),
    keyVersion: Number(r.key_version),
    wrapDekVersion: Number(r.wrap_dek_version),
    wrappedFileKey: r.wrapped_file_key as Buffer,
  };
}

export interface CaseGate {
  readonly id: string;
  readonly status: string;
  readonly legalHold: boolean;
}

/** Dava (RLS görünürlüğü); görünmüyorsa `null`. */
export async function getCaseGate(
  tx: TenantTx,
  orgId: string,
  caseId: string,
): Promise<CaseGate | null> {
  const r = await tx.query(
    'SELECT id, status, legal_hold FROM app.cases WHERE org_id = $1 AND id = $2',
    [orgId, caseId],
  );
  const x = r.rows[0] as Record<string, unknown> | undefined;
  return x === undefined
    ? null
    : { id: String(x.id), status: String(x.status), legalHold: x.legal_hold === true };
}

export async function orgLegalHold(tx: TenantTx, orgId: string): Promise<boolean> {
  const r = await tx.query('SELECT legal_hold FROM app.org_settings WHERE org_id = $1', [orgId]);
  return (r.rows[0] as { legal_hold?: boolean } | undefined)?.legal_hold === true;
}

/** Davadaki silinmemiş evrak sayısı (`upload.maxFilesPerCase` ön kontrolü). */
export async function countCaseFiles(tx: TenantTx, orgId: string, caseId: string): Promise<number> {
  const r = await tx.query(
    `SELECT count(*)::int AS n FROM app.files
      WHERE org_id = $1 AND case_id = $2 AND delete_requested_at IS NULL`,
    [orgId, caseId],
  );
  return Number((r.rows[0] as { n?: number } | undefined)?.n ?? 0);
}

export interface NewFile {
  readonly id: string;
  readonly caseId: string | null;
  readonly origin: string;
  readonly originId: string | null;
  readonly uploadedBy: string;
  readonly originalName: string;
  readonly nameFold: string;
  readonly fileType: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: Buffer;
  readonly objectKey: string;
  readonly keyVersion: number;
  readonly wrapDekVersion: number;
  readonly wrappedFileKey: Buffer;
  /** Yalnız inbox (`case_id NULL`); dava evrakında `null`. */
  readonly inboxExpiresAt: Date | null;
}

/**
 * Evrak satırı. Aynı davada aynı özet (silinmemiş) varsa satır yazılmaz ve `null` döner
 * (`files_case_sha_uq`, yarış güvenli; 033 §6.5).
 */
export async function insertFile(tx: TenantTx, orgId: string, v: NewFile): Promise<FileRow | null> {
  const r = await tx.query(
    `INSERT INTO app.files (id, org_id, case_id, origin, origin_id, uploaded_by, original_name, name_fold,
       file_type, mime_type, size_bytes, sha256, object_key, key_version, wrap_dek_version,
       wrapped_file_key, inbox_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     ON CONFLICT (org_id, case_id, sha256) WHERE case_id IS NOT NULL AND delete_requested_at IS NULL
     DO NOTHING
     RETURNING ${COLS}`,
    [
      v.id,
      orgId,
      v.caseId,
      v.origin,
      v.originId,
      v.uploadedBy,
      v.originalName,
      v.nameFold,
      v.fileType,
      v.mimeType,
      v.sizeBytes,
      v.sha256,
      v.objectKey,
      v.keyVersion,
      v.wrapDekVersion,
      v.wrappedFileKey,
      v.inboxExpiresAt,
    ],
  );
  const x = r.rows[0] as Record<string, unknown> | undefined;
  return x === undefined ? null : rowOf(x);
}

/** Aynı davada aynı özetli silinmemiş evrak kimliği (mükerrer yanıtı için). */
export async function findDuplicateId(
  tx: TenantTx,
  orgId: string,
  caseId: string,
  sha256: Buffer,
): Promise<string | null> {
  const r = await tx.query(
    `SELECT id FROM app.files
      WHERE org_id = $1 AND case_id = $2 AND sha256 = $3 AND delete_requested_at IS NULL LIMIT 1`,
    [orgId, caseId, sha256],
  );
  const x = r.rows[0] as { id?: string } | undefined;
  return x?.id ?? null;
}

/** Silme istenmemiş evrak (RLS); yoksa `null`. */
export async function getFile(tx: TenantTx, orgId: string, id: string): Promise<FileRow | null> {
  const r = await tx.query(
    `SELECT ${COLS} FROM app.files WHERE org_id = $1 AND id = $2 AND delete_requested_at IS NULL`,
    [orgId, id],
  );
  const x = r.rows[0] as Record<string, unknown> | undefined;
  return x === undefined ? null : rowOf(x);
}

/** İçerik okuma için anahtar malzemeli satır; silme istenmemiş (RLS). */
export async function getFileKeyed(
  tx: TenantTx,
  orgId: string,
  id: string,
): Promise<FileKeyed | null> {
  const r = await tx.query(
    `SELECT ${KEYED_COLS} FROM app.files
      WHERE org_id = $1 AND id = $2 AND delete_requested_at IS NULL`,
    [orgId, id],
  );
  const x = r.rows[0] as Record<string, unknown> | undefined;
  return x === undefined ? null : keyedOf(x);
}

export async function listCaseFiles(
  tx: TenantTx,
  orgId: string,
  caseId: string,
  q: {
    status: string | null;
    before: { createdAt: Date; id: string } | null;
    limit: number;
  },
): Promise<FileRow[]> {
  const r = await tx.query(
    `SELECT ${COLS} FROM app.files
      WHERE org_id = $1 AND case_id = $2 AND delete_requested_at IS NULL
        AND ($3::text IS NULL OR status = $3)
        AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY created_at DESC, id DESC
      LIMIT $6`,
    [orgId, caseId, q.status, q.before?.createdAt ?? null, q.before?.id ?? null, q.limit + 1],
  );
  return r.rows.map((x) => rowOf(x as Record<string, unknown>));
}

/** Silme isteği: evrak anında listeden çıkar (RLS UPDATE). Satır yoksa `null`. */
export async function markDeleteRequested(
  tx: TenantTx,
  orgId: string,
  id: string,
  userId: string,
): Promise<{ deleteRequestedAt: Date } | null> {
  const r = await tx.query(
    `UPDATE app.files SET delete_requested_at = now(), delete_requested_by = $3
      WHERE org_id = $1 AND id = $2 AND delete_requested_at IS NULL
      RETURNING delete_requested_at`,
    [orgId, id, userId],
  );
  const x = r.rows[0] as { delete_requested_at?: Date } | undefined;
  return x === undefined ? null : { deleteRequestedAt: d(x.delete_requested_at) };
}

/**
 * Karantina: grace'siz anında silme, DB önce (`wrapped_file_key` yok olur, nesne kriptografik olarak
 * okunamaz hâle gelir). `file_texts` ve `file_chunks` FK `ON DELETE CASCADE` ile birlikte gider
 * (`eda_app` bu tablolarda DELETE yetkisi taşımaz; cascade tablo sahibi yetkisiyle işler).
 */
export async function purgeFileRows(tx: TenantTx, orgId: string, id: string): Promise<boolean> {
  const r = await tx.query('DELETE FROM app.files WHERE org_id = $1 AND id = $2', [orgId, id]);
  return (r.rowCount ?? 0) > 0;
}

export interface NewCustody {
  readonly fileId: string;
  readonly caseId: string | null;
  readonly event: string;
  readonly actorId: string | null;
  readonly sha256: Buffer | null;
  readonly ipTrunc: string | null;
  /** `parseCustodyMetadata` ile doğrulanmış, içeriksiz. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** Ekli delil zinciri satırı (UPDATE/DELETE yetkisi yoktur; 033 §8.1). */
export async function insertCustody(tx: TenantTx, orgId: string, v: NewCustody): Promise<void> {
  await tx.query(
    `INSERT INTO app.custody_events (org_id, file_id, case_id, event, actor_type, actor_id, sha256,
       ip_trunc, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::inet, $9::jsonb)`,
    [
      orgId,
      v.fileId,
      v.caseId,
      v.event,
      v.actorId === null ? 'system' : 'user',
      v.actorId,
      v.sha256,
      v.ipTrunc,
      JSON.stringify(v.metadata),
    ],
  );
}
