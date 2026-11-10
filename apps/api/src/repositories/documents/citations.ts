// `app.message_citations` belge atıfları deposu (025 §12.4; P17b.6). Yetkili durum bu tablodadır;
// düğümdeki `status` yalnız gösterim önbelleğidir. Doğrulama algoritması P13'tedir.
import type { KunyeStatus } from '@eda/contracts/enums';
import type { TenantTx } from '@eda/db';

export interface DocCitationRow {
  readonly id: string;
  readonly raw: string;
  readonly status: KunyeStatus;
  readonly blocking: 'none' | 'soft' | 'hard';
  readonly reason: string | null;
}

export async function getCitationsOfDocument(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  ids: readonly string[],
): Promise<DocCitationRow[]> {
  if (ids.length === 0) return [];
  const r = await tx.query<DocCitationRow>(
    `SELECT id, raw, status, blocking, reason FROM app.message_citations
      WHERE org_id = $1 AND document_id = $2 AND id = ANY($3::uuid[])`,
    [orgId, documentId, ids],
  );
  return r.rows;
}

export interface NewCitation {
  readonly id: string;
  readonly blockId: string;
  readonly raw: string;
  readonly parsed: unknown;
}

/** `ON CONFLICT (id) DO NOTHING`: yalnız bu çağrıda açılan satırlar döner. */
export async function insertCitationIfAbsent(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  c: NewCitation,
): Promise<DocCitationRow | null> {
  const r = await tx.query<DocCitationRow>(
    `INSERT INTO app.message_citations (id, org_id, document_id, block_id, raw, parsed)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, raw, status, blocking, reason`,
    [c.id, orgId, documentId, c.blockId, c.raw, JSON.stringify(c.parsed)],
  );
  return r.rows[0] ?? null;
}

/** `raw` değişince kanonik anahtar farkı durumu `pending`e döndürür (025 §3.3). */
export async function resetCitation(
  tx: TenantTx,
  orgId: string,
  documentId: string,
  c: NewCitation,
): Promise<DocCitationRow | null> {
  const r = await tx.query<DocCitationRow>(
    `UPDATE app.message_citations SET
        raw = $4, parsed = $5::jsonb, block_id = $6, status = 'pending', reason = NULL,
        attested_by = NULL, attested_at = NULL, check_attempts = 0
      WHERE org_id = $1 AND document_id = $2 AND id = $3
      RETURNING id, raw, status, blocking, reason`,
    [orgId, documentId, c.id, c.raw, JSON.stringify(c.parsed), c.blockId],
  );
  return r.rows[0] ?? null;
}

export async function countCitationsByStatus(
  tx: TenantTx,
  orgId: string,
  documentId: string,
): Promise<Record<string, number>> {
  const r = await tx.query<{ status: string; n: string }>(
    `SELECT status, count(*)::text AS n FROM app.message_citations
      WHERE org_id = $1 AND document_id = $2 GROUP BY status`,
    [orgId, documentId],
  );
  return Object.fromEntries(r.rows.map((x) => [x.status, Number(x.n)]));
}
