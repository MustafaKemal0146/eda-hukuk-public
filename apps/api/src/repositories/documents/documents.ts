// `app.documents` deposu (030 §8; P17b.3). Her fonksiyon çağıranın `withTenant` işlemini (`TenantTx`)
// ve `orgId`'yi alır; RLS ek olarak satır erişimini sınırlar (031). SQL yalnız burada yazılır.
import type { DocumentKind, DocumentStatus, DocumentSubtype } from '@eda/contracts/enums';
import type { TenantTx } from '@eda/db';
import {
  type DocumentListRow,
  type DocumentRow,
  documentFromRow,
  documentListFromRow,
} from './rows.ts';

const LIST_COLS = `d.id, d.org_id, d.owner_id, d.case_id, d.source_conversation_id,
  d.responds_to_file_id, d.template_id, d.kind, d.subtype, d.status, d.title, d.draft_rev,
  d.draft_saved_at, d.generation_status, d.approved_at, d.filed_declared_at, d.last_exported_at,
  d.created_at, d.updated_at`;
const FULL_COLS = `${LIST_COLS}, d.draft, d.outline`;

export interface InsertDocument {
  readonly ownerId: string;
  readonly caseId: string | null;
  readonly kind: DocumentKind;
  readonly subtype: DocumentSubtype | null;
  readonly templateId: string | null;
  readonly title: string;
  readonly titleFold: string;
  readonly draft: unknown;
}

export async function insertDocument(
  tx: TenantTx,
  orgId: string,
  v: InsertDocument,
): Promise<DocumentRow> {
  const r = await tx.query(
    `INSERT INTO app.documents AS d
       (org_id, owner_id, case_id, template_id, kind, subtype, title, title_fold, draft)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING ${FULL_COLS}, false AS session_expired`,
    [
      orgId,
      v.ownerId,
      v.caseId,
      v.templateId,
      v.kind,
      v.subtype,
      v.title,
      v.titleFold,
      JSON.stringify(v.draft),
    ],
  );
  return documentFromRow(r.rows[0] as Record<string, unknown>);
}

/** `lock = true`: satır kilidi (sürüm ve durum yazımları aynı işlemde sıralanır). */
export async function getDocument(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  opts: { lock?: boolean; sessionMin?: number } = {},
): Promise<DocumentRow | null> {
  const r = await tx.query(
    `SELECT ${FULL_COLS},
            (d.draft_saved_at IS NOT NULL
             AND d.draft_saved_at <= now() - make_interval(mins => $3::int)) AS session_expired
       FROM app.documents d
      WHERE d.org_id = $1 AND d.id = $2
      ${opts.lock === true ? 'FOR UPDATE OF d' : ''}`,
    [orgId, documentId, opts.sessionMin ?? 0],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : documentFromRow(row);
}

export type ListSort = 'updated_desc' | 'created_desc' | 'title_asc';

export interface ListFilters {
  readonly kind?: DocumentKind | undefined;
  readonly status?: DocumentStatus | undefined;
  readonly caseId?: string | undefined;
}

export interface SortCursor {
  /** Sıralama anahtarı değeri (ISO zaman veya `title_fold`). */
  readonly k: string;
  readonly id: string;
}

const SORT_SQL: Record<ListSort, { col: string; dir: 'DESC' | 'ASC'; cast: string }> = {
  updated_desc: { col: 'd.updated_at', dir: 'DESC', cast: 'timestamptz' },
  created_desc: { col: 'd.created_at', dir: 'DESC', cast: 'timestamptz' },
  title_asc: { col: 'd.title_fold', dir: 'ASC', cast: 'text' },
};

/** Sıralama anahtarı değerini imleç dizesine çevirir (Date → ISO). */
export function sortKeyOf(sort: ListSort, row: DocumentListRow & { titleFold?: string }): string {
  if (sort === 'title_asc') return row.title;
  return (sort === 'updated_desc' ? row.updatedAt : row.createdAt).toISOString();
}

export async function listDocuments(
  tx: TenantTx,
  orgId: string,
  f: ListFilters,
  sort: ListSort,
  cursor: SortCursor | null,
  limit: number,
): Promise<{ rows: DocumentListRow[]; keys: string[] }> {
  const s = SORT_SQL[sort];
  const params: unknown[] = [orgId];
  const where = ['d.org_id = $1'];
  if (f.kind !== undefined) where.push(`d.kind = $${params.push(f.kind)}`);
  if (f.status !== undefined) where.push(`d.status = $${params.push(f.status)}`);
  if (f.caseId !== undefined) where.push(`d.case_id = $${params.push(f.caseId)}`);
  if (cursor !== null) {
    const k = params.push(cursor.k);
    const id = params.push(cursor.id);
    const cmp = s.dir === 'DESC' ? '<' : '>';
    where.push(`(${s.col}, d.id) ${cmp} ($${k}::${s.cast}, $${id}::uuid)`);
  }
  const lim = params.push(limit + 1);
  const r = await tx.query(
    `SELECT ${LIST_COLS}, ${s.col}::text AS sort_key
       FROM app.documents d
      WHERE ${where.join(' AND ')}
      ORDER BY ${s.col} ${s.dir}, d.id ${s.dir}
      LIMIT $${lim}`,
    params,
  );
  const raw = r.rows as Record<string, unknown>[];
  return {
    rows: raw.map(documentListFromRow),
    keys: raw.map((x) => x.sort_key as string),
  };
}

export interface CaseFacts {
  readonly archived: boolean;
  readonly legalHold: boolean;
}

/** Erişilebilir davanın bayrakları; erişilemeyen/yok dava `null` (RLS). */
export async function getCaseFacts(
  tx: TenantTx,
  orgId: string,
  caseId: string,
): Promise<CaseFacts | null> {
  const r = await tx.query<{ status: string; legal_hold: boolean }>(
    'SELECT status, legal_hold FROM app.cases WHERE org_id = $1 AND id = $2',
    [orgId, caseId],
  );
  const row = r.rows[0];
  return row === undefined
    ? null
    : { archived: row.status === 'archived', legalHold: row.legal_hold };
}

export async function getOrgLegalHold(tx: TenantTx, orgId: string): Promise<boolean> {
  const r = await tx.query<{ legal_hold: boolean }>(
    'SELECT legal_hold FROM app.org_settings WHERE org_id = $1',
    [orgId],
  );
  return r.rows[0]?.legal_hold === true;
}

export async function updateTitle(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  title: string,
  titleFold: string,
): Promise<void> {
  await tx.query(
    'UPDATE app.documents SET title = $3, title_fold = $4 WHERE org_id = $1 AND id = $2',
    [orgId, documentId, title, titleFold],
  );
}

export interface StatusChange {
  readonly status: DocumentStatus;
  readonly actorId: string;
}

/** Durum ve ilgili beyan alanları tek ifadede; çıkılan durumun alanları temizlenir. */
export async function updateStatus(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  c: StatusChange,
): Promise<void> {
  await tx.query(
    `UPDATE app.documents SET
        status = $3,
        approved_by = CASE WHEN $3 = 'approved' THEN $4::uuid ELSE NULL END,
        approved_at = CASE WHEN $3 = 'approved' THEN now() ELSE NULL END,
        filed_declared_by = CASE WHEN $3 = 'filed_declared' THEN $4::uuid ELSE NULL END,
        filed_declared_at = CASE WHEN $3 = 'filed_declared' THEN now() ELSE NULL END,
        archived_at = CASE WHEN $3 = 'archived' THEN now() ELSE NULL END
      WHERE org_id = $1 AND id = $2`,
    [orgId, documentId, c.status, c.actorId],
  );
}

export interface DraftWrite {
  readonly draft: unknown;
  readonly baseRev: number;
  /** Okunan durum; eşzamanlı durum değişimi koşulu bozar (0 satır). */
  readonly expectStatus: DocumentStatus;
  /** `approved`/`exported` belgede ilk içerik değişikliği durumu `draft` yapar (054 §10.4). */
  readonly resetToDraft: boolean;
}

/**
 * Taslak yazımı: TEK koşullu UPDATE (`draft_rev` + durum + üretim boşta). 0 satır dönerse çağıran
 * güncel satırı okuyup 409/423 ayırır; ara yazım yapılmaz (P17b.3).
 */
export async function casWriteDraft(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  w: DraftWrite,
): Promise<{ draftRev: number; savedAt: Date } | null> {
  const r = await tx.query<{ draft_rev: string; draft_saved_at: Date }>(
    `UPDATE app.documents SET
        draft = $4::jsonb,
        draft_rev = draft_rev + 1,
        draft_saved_at = now(),
        status = CASE WHEN $6::boolean THEN 'draft' ELSE status END,
        approved_by = CASE WHEN $6::boolean THEN NULL ELSE approved_by END,
        approved_at = CASE WHEN $6::boolean THEN NULL ELSE approved_at END
      WHERE org_id = $1 AND id = $2 AND draft_rev = $3
        AND status = $5 AND generation_status = 'idle'
      RETURNING draft_rev, draft_saved_at`,
    [orgId, documentId, w.baseRev, JSON.stringify(w.draft), w.expectStatus, w.resetToDraft],
  );
  const row = r.rows[0];
  return row === undefined
    ? null
    : { draftRev: Number(row.draft_rev), savedAt: row.draft_saved_at };
}

export async function deleteDocument(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<number> {
  const r = await tx.query('DELETE FROM app.documents WHERE org_id = $1 AND id = $2', [
    orgId,
    documentId,
  ]);
  return r.rowCount ?? 0;
}

export async function countPendingSuggestions(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<number> {
  const r = await tx.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM app.document_suggestions
      WHERE org_id = $1 AND document_id = $2 AND status = 'pending'`,
    [orgId, documentId],
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Geri yüklemede bekleyen öneriler eskir (054 §8.4); öneri hattı P18'de dolar. */
export async function markPendingSuggestionsStale(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<void> {
  await tx.query(
    `UPDATE app.document_suggestions SET status = 'stale'
      WHERE org_id = $1 AND document_id = $2 AND status = 'pending'`,
    [orgId, documentId],
  );
}
