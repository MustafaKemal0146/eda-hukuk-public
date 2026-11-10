// Defter tabloları (032 §4.1): `public.schema_migrations` ve `public.seed_runs`. Çalıştırıcı bunları
// hiçbir migrasyondan önce kurar; sahibi eda_owner'dır ve çalışma zamanı rollerine yetki verilmez (E4).
// Testler aynı sözleşmeyi yalıtılmış bir şemada (ledgerSchema) sınar.
import type { ClientBase } from 'pg';

export interface LedgerRow {
  readonly seq: number;
  readonly id: string;
  readonly sha256: Buffer;
  readonly kind: string;
}

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export function ledgerSchemaIdent(schema: string): string {
  if (!IDENT.test(schema)) throw new Error(`geçersiz defter şeması: ${schema}`);
  return schema;
}

export async function ensureLedger(client: ClientBase, schema: string): Promise<void> {
  const s = ledgerSchemaIdent(schema);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${s}.schema_migrations (
      seq         int         PRIMARY KEY,
      id          text        NOT NULL UNIQUE,
      sha256      bytea       NOT NULL CHECK (octet_length(sha256) = 32),
      kind        text        NOT NULL,
      tx_mode     text        NOT NULL CHECK (tx_mode IN ('transaction', 'none')),
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms int         NOT NULL,
      attempts    int         NOT NULL DEFAULT 1,
      applied_by  text        NOT NULL DEFAULT current_user
    );
    CREATE TABLE IF NOT EXISTS ${s}.seed_runs (
      id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      seed_name      text        NOT NULL,
      profile        text        NOT NULL CHECK (profile IN ('prod', 'dev')),
      content_sha256 bytea       NOT NULL CHECK (octet_length(content_sha256) = 32),
      inserted       int         NOT NULL DEFAULT 0,
      updated        int         NOT NULL DEFAULT 0,
      skipped        int         NOT NULL DEFAULT 0,
      applied_at     timestamptz NOT NULL DEFAULT now(),
      duration_ms    int         NOT NULL
    );
    CREATE INDEX IF NOT EXISTS seed_runs_name_idx ON ${s}.seed_runs (seed_name, profile, id DESC);
  `);
}

export async function readLedger(client: ClientBase, schema: string): Promise<LedgerRow[]> {
  const s = ledgerSchemaIdent(schema);
  const res = await client.query<LedgerRow>(
    `SELECT seq, id, sha256, kind FROM ${s}.schema_migrations ORDER BY seq`,
  );
  return res.rows;
}

export interface LedgerInsert {
  readonly seq: number;
  readonly id: string;
  readonly sha256: Buffer;
  readonly kind: string;
  readonly txMode: 'transaction' | 'none';
  readonly durationMs: number;
  readonly attempts: number;
}

export async function insertLedger(
  client: ClientBase,
  schema: string,
  row: LedgerInsert,
): Promise<void> {
  const s = ledgerSchemaIdent(schema);
  await client.query(
    `INSERT INTO ${s}.schema_migrations (seq, id, sha256, kind, tx_mode, duration_ms, attempts)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.seq, row.id, row.sha256, row.kind, row.txMode, row.durationMs, row.attempts],
  );
}
