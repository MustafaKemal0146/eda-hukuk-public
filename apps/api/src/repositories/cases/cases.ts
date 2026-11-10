// `app.cases` deposu (030 §6). Her fonksiyon çağıranın `withTenant` işlemini alır; görünürlük
// (`org` / `restricted` + üyelik) RLS'dedir. SQL yalnız burada. Başlık araması `title_fold` ön ekidir.
import type { TenantTx } from '@eda/db';

export interface CaseRow {
  readonly id: string;
  readonly title: string;
  readonly officeFileCode: string | null;
  readonly esasNo: string | null;
  readonly status: string;
  readonly visibility: string;
  readonly openedDate: string | null;
  readonly createdBy: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const COLS = `id, title, office_file_code, esas_no, status, visibility, opened_date::text AS opened_date,
  created_by, created_at, updated_at`;

const d = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function rowOf(r: Record<string, unknown>): CaseRow {
  return {
    id: String(r.id),
    title: String(r.title),
    officeFileCode: s(r.office_file_code),
    esasNo: s(r.esas_no),
    status: String(r.status),
    visibility: String(r.visibility),
    openedDate: s(r.opened_date),
    createdBy: s(r.created_by),
    createdAt: d(r.created_at),
    updatedAt: d(r.updated_at),
  };
}

export async function listCases(
  tx: TenantTx,
  orgId: string,
  q: {
    titlePrefix: string | null;
    status: string | null;
    before: { updatedAt: Date; id: string } | null;
    limit: number;
  },
): Promise<CaseRow[]> {
  const r = await tx.query(
    `SELECT ${COLS} FROM app.cases
      WHERE org_id = $1
        AND ($2::text IS NULL OR title_fold LIKE $2 || '%' OR office_file_code ILIKE $2 || '%' OR esas_no LIKE $2 || '%')
        AND ($3::text IS NULL OR status = $3)
        AND ($4::timestamptz IS NULL OR (updated_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY updated_at DESC, id DESC
      LIMIT $6`,
    [
      orgId,
      q.titlePrefix,
      q.status,
      q.before?.updatedAt ?? null,
      q.before?.id ?? null,
      q.limit + 1,
    ],
  );
  return r.rows.map((x) => rowOf(x as Record<string, unknown>));
}

export async function getCase(tx: TenantTx, orgId: string, id: string): Promise<CaseRow | null> {
  const r = await tx.query(`SELECT ${COLS} FROM app.cases WHERE org_id = $1 AND id = $2`, [
    orgId,
    id,
  ]);
  const x = r.rows[0];
  return x === undefined ? null : rowOf(x as Record<string, unknown>);
}

export async function insertCase(
  tx: TenantTx,
  orgId: string,
  v: {
    ownerId: string;
    title: string;
    titleFold: string;
    officeFileCode: string | null;
    esasNo: string | null;
    visibility: string;
    openedDate: string | null;
  },
): Promise<CaseRow> {
  const r = await tx.query(
    `INSERT INTO app.cases (org_id, owner_id, created_by, title, title_fold, office_file_code, esas_no,
       visibility, opened_date)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8::date)
     RETURNING ${COLS}`,
    [
      orgId,
      v.ownerId,
      v.title,
      v.titleFold,
      v.officeFileCode,
      v.esasNo,
      v.visibility,
      v.openedDate,
    ],
  );
  return rowOf(r.rows[0] as Record<string, unknown>);
}

export async function patchCase(
  tx: TenantTx,
  orgId: string,
  id: string,
  v: {
    title?: string;
    titleFold?: string;
    officeFileCode?: string | null;
    esasNo?: string | null;
    status?: string;
  },
): Promise<CaseRow | null> {
  const r = await tx.query(
    `UPDATE app.cases SET
       title = COALESCE($3, title),
       title_fold = COALESCE($4, title_fold),
       office_file_code = CASE WHEN $5 THEN $6 ELSE office_file_code END,
       esas_no = CASE WHEN $7 THEN $8 ELSE esas_no END,
       status = COALESCE($9, status)
     WHERE org_id = $1 AND id = $2
     RETURNING ${COLS}`,
    [
      orgId,
      id,
      v.title ?? null,
      v.titleFold ?? null,
      v.officeFileCode !== undefined,
      v.officeFileCode ?? null,
      v.esasNo !== undefined,
      v.esasNo ?? null,
      v.status ?? null,
    ],
  );
  const x = r.rows[0];
  return x === undefined ? null : rowOf(x as Record<string, unknown>);
}
