// `app.templates` okuma deposu (P17b.9): platform (`org_id IS NULL`) ve büro şablonları; RLS
// select politikası kiracı sınırını uygular. İçerik yalnız belge oluştururken sunucuda okunur.
import type { DocumentKind, DocumentSubtype } from '@eda/contracts/enums';
import type { TenantTx } from '@eda/db';
import { type TemplateRow, templateFromRow } from './rows.ts';

const COLS =
  'id, org_id, kind, subtype, title, description, case_type_code, version, is_active, updated_at';

export async function listTemplates(
  tx: TenantTx,
  orgId: string,
  f: {
    kind?: DocumentKind | undefined;
    subtype?: DocumentSubtype | undefined;
    platformOnly: boolean;
  },
): Promise<TemplateRow[]> {
  const params: unknown[] = [orgId];
  const where = ['t.is_active', '(t.org_id IS NULL OR t.org_id = $1)'];
  if (f.platformOnly) where.push('t.org_id IS NULL');
  if (f.kind !== undefined) where.push(`t.kind = $${params.push(f.kind)}`);
  if (f.subtype !== undefined) where.push(`t.subtype = $${params.push(f.subtype)}`);
  const r = await tx.query(
    `SELECT ${COLS.split(', ')
      .map((c) => `t.${c}`)
      .join(', ')}
       FROM app.templates t
      WHERE ${where.join(' AND ')}
      ORDER BY (t.org_id IS NULL) DESC, t.title, t.id`,
    params,
  );
  return (r.rows as Record<string, unknown>[]).map(templateFromRow);
}

export interface TemplateContent {
  readonly kind: DocumentKind;
  readonly subtype: DocumentSubtype | null;
  readonly content: unknown;
}

/** Belge oluşturmada kopyalanacak içerik; pasif/erişilemez şablon `null`. */
export async function getTemplateContent(
  tx: TenantTx,
  orgId: string,
  templateId: string,
): Promise<TemplateContent | null> {
  const r = await tx.query<{
    kind: DocumentKind;
    subtype: DocumentSubtype | null;
    content: unknown;
  }>(
    `SELECT kind, subtype, content FROM app.templates
      WHERE id = $2 AND is_active AND (org_id IS NULL OR org_id = $1)`,
    [orgId, templateId],
  );
  const row = r.rows[0];
  return row === undefined ? null : { kind: row.kind, subtype: row.subtype, content: row.content };
}
