// `app.document_versions` deposu (030 §8): tam kopya, değişmez; yalnız `name` güncellenir.
// Sürüm yazımları çağıranın belge satırı kilidi altında yapılır (sürüm numarası çakışmaz).
import type { DocumentVersionSource, DocumentVersionTrigger } from '@eda/contracts/enums';
import type { TenantTx } from '@eda/db';
import { type VersionContentRow, type VersionRow, versionFromRow } from './rows.ts';

const META_COLS = 'id, version_no, source, trigger, name, base_draft_rev, created_by, created_at';

export interface InsertVersion {
  readonly documentId: string;
  readonly source: DocumentVersionSource;
  readonly trigger: DocumentVersionTrigger;
  readonly name: string | null;
  readonly content: unknown;
  readonly baseDraftRev: number;
  readonly createdBy: string | null;
}

export async function insertVersion(
  tx: TenantTx,
  orgId: string,
  v: InsertVersion,
): Promise<VersionRow> {
  const r = await tx.query(
    `INSERT INTO app.document_versions
       (org_id, document_id, version_no, source, trigger, name, content, base_draft_rev, created_by)
     VALUES ($1, $2,
       (SELECT COALESCE(MAX(version_no), 0) + 1 FROM app.document_versions
         WHERE org_id = $1 AND document_id = $2),
       $3, $4, $5, $6::jsonb, $7, $8)
     RETURNING ${META_COLS}`,
    [
      orgId,
      v.documentId,
      v.source,
      v.trigger,
      v.name,
      JSON.stringify(v.content),
      v.baseDraftRev,
      v.createdBy,
    ],
  );
  return versionFromRow(r.rows[0] as Record<string, unknown>);
}

export async function getLatestVersion(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<VersionContentRow | null> {
  const r = await tx.query(
    `SELECT ${META_COLS}, content FROM app.document_versions
      WHERE org_id = $1 AND document_id = $2
      ORDER BY version_no DESC LIMIT 1`,
    [orgId, documentId],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : { ...versionFromRow(row), content: row.content };
}

export async function getVersion(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  versionId: string,
): Promise<VersionContentRow | null> {
  const r = await tx.query(
    `SELECT ${META_COLS}, content FROM app.document_versions
      WHERE org_id = $1 AND document_id = $2 AND id = $3`,
    [orgId, documentId, versionId],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : { ...versionFromRow(row), content: row.content };
}

/** `-versionNo` sabit sıra; imleç = son görülen `version_no`. */
export async function listVersions(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  before: number | null,
  limit: number,
): Promise<VersionRow[]> {
  const r = await tx.query(
    `SELECT ${META_COLS} FROM app.document_versions
      WHERE org_id = $1 AND document_id = $2 AND ($3::int IS NULL OR version_no < $3)
      ORDER BY version_no DESC LIMIT $4`,
    [orgId, documentId, before, limit + 1],
  );
  return (r.rows as Record<string, unknown>[]).map(versionFromRow);
}

/** Yalnız `name`: sütun düzeyi yetki (`GRANT UPDATE (name)`) başka alanı yazdırmaz. */
export async function setVersionName(
  tx: TenantTx,
  orgId: string,
  versionId: string,
  name: string,
): Promise<VersionRow | null> {
  const r = await tx.query(
    `UPDATE app.document_versions SET name = $3
      WHERE org_id = $1 AND id = $2 RETURNING ${META_COLS}`,
    [orgId, versionId, name],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : versionFromRow(row);
}
