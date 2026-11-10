// `-- eda:backfill` / `-- eda:backfill-batched` sarmalayıcısı (032 §9.2). FORCE RLS tablo sahibini de
// kapsadığı için eda_owner'ın bağlamsız UPDATE'i hata vermeden 0 satır etkiler (032 §9.1). Çalıştırıcı
// gövdeyi BYPASSRLS'li eda_sec_definer rolüyle koşar; dar kolon yetkisi AYNI işlemde verilir ve
// geri alınır (işlem geri alınırsa hiçbiri kalmaz). Yetki kalıntısını audit-extra E5 yakalar.
import type { ClientBase } from 'pg';
import type { BackfillSpec } from './header.ts';

export const BACKFILL_ROLE = 'eda_sec_definer';

export interface GrantPlan {
  readonly grant: readonly string[];
  readonly revoke: readonly string[];
}

const quote = (ident: string): string => `"${ident}"`;

/**
 * Sarmalayıcının vereceği ve geri alacağı yetkiler: hedef kolonlarda SELECT + UPDATE (+ `+insert`
 * ise INSERT), okunan anahtar kolonlarda (`id`, varsa `org_id`) SELECT. Rolün zaten sahip olduğu
 * yetki ne verilir ne geri alınır (manifestteki kalıcı yetkiler korunur).
 */
export async function planGrants(client: ClientBase, spec: BackfillSpec): Promise<GrantPlan> {
  const table = `${quote(spec.schema)}.${quote(spec.table)}`;
  const cols = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [spec.schema, spec.table],
  );
  const existing = new Set(cols.rows.map((r) => r.column_name));
  for (const c of spec.columns) {
    if (!existing.has(c)) throw new Error(`backfill kolonu yok: ${spec.schema}.${spec.table}.${c}`);
  }
  const keyCols = ['id', 'org_id'].filter((c) => existing.has(c));
  const wants: [privilege: 'SELECT' | 'UPDATE' | 'INSERT', column: string][] = [];
  for (const c of new Set([...keyCols, ...spec.columns])) wants.push(['SELECT', c]);
  for (const c of spec.columns) wants.push(spec.insert ? ['INSERT', c] : ['UPDATE', c]);

  const grant: string[] = [];
  const revoke: string[] = [];
  for (const [privilege, column] of wants) {
    const has = await client.query<{ ok: boolean }>(
      'SELECT has_column_privilege($1, $2::regclass, $3, $4) AS ok',
      [BACKFILL_ROLE, `${spec.schema}.${spec.table}`, column, privilege],
    );
    if (has.rows[0]?.ok) continue;
    grant.push(`GRANT ${privilege} (${quote(column)}) ON ${table} TO ${BACKFILL_ROLE}`);
    revoke.push(`REVOKE ${privilege} (${quote(column)}) ON ${table} FROM ${BACKFILL_ROLE}`);
  }
  return { grant, revoke };
}

/** Gövdeyi işlem içinde (çağıran BEGIN/COMMIT'i yönetir) dar yetkiyle çalıştırır; etkilenen satırı döndürür. */
export async function runWrapped(
  client: ClientBase,
  spec: BackfillSpec,
  body: string,
): Promise<number> {
  const plan = await planGrants(client, spec);
  for (const g of plan.grant) await client.query(g);
  await client.query(`SET LOCAL ROLE ${BACKFILL_ROLE}`);
  const res = await client.query(body);
  await client.query('RESET ROLE');
  for (const r of plan.revoke) await client.query(r);
  if (Array.isArray(res)) {
    if (spec.batched) throw new Error('backfill-batched gövdesi tek deyim olmalıdır');
    return res.reduce((n, r: { rowCount: number | null }) => n + (r.rowCount ?? 0), 0);
  }
  return res.rowCount ?? 0;
}

/** `$batch` yer tutucusunu doğrulanmış tamsayıyla değiştirir. */
export function bindBatch(body: string, batchSize: number): string {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new Error('geçersiz yığın boyu');
  return body.replaceAll('$batch', String(batchSize));
}
