// Denetim sorguları (031 §13 Q1–Q12, 032 §6.5 E-serisi): migrate'in son adımı; her sorgu 0 satır
// döndürmelidir, aksi hâlde çıkış 50. Dosyalar psql söz dizimindedir: `-- Qn:` / `-- En:` ayraçlarıyla
// bölünür, `:'ad'` değişkenleri konumsal parametreye ($n) çevrilir (032 Tuzak 19).
import { readFile } from 'node:fs/promises';
import type { ClientBase } from 'pg';
import { EXIT, MigrateError } from './exit-codes.ts';
import type { MigrateLogger } from './log.ts';

export interface AuditQuery {
  readonly id: string;
  readonly sql: string;
  readonly params: readonly string[];
}

export type AuditParams = Readonly<Record<string, string | readonly string[]>>;

const MARKER = /^--\s*([QE][0-9]{1,2}):/;
const VARIABLE = /:'([a-z_][a-z0-9_]*)'/g;

/** psql dosyasını ayraçlardan böler; ayraçtan önceki metin (dosya başlığı) atılır. */
export function splitAuditFile(text: string): AuditQuery[] {
  const out: AuditQuery[] = [];
  let current: { id: string; lines: string[] } | null = null;
  const flush = (): void => {
    if (current === null) return;
    const body = current.lines.join('\n').trim().replace(/;\s*$/, '');
    const params: string[] = [];
    const sql = body.replace(VARIABLE, (_m, name: string) => {
      let i = params.indexOf(name);
      if (i < 0) {
        params.push(name);
        i = params.length - 1;
      }
      return `$${i + 1}`;
    });
    out.push({ id: current.id, sql, params });
  };
  for (const line of text.split('\n')) {
    const m = MARKER.exec(line);
    if (m) {
      flush();
      current = { id: m[1] ?? '', lines: [] };
    } else if (current !== null) {
      current.lines.push(line);
    }
  }
  flush();
  return out;
}

export async function loadAuditQueries(files: readonly string[]): Promise<AuditQuery[]> {
  const all: AuditQuery[] = [];
  for (const f of files) all.push(...splitAuditFile(await readFile(f, 'utf8')));
  return all;
}

export interface AuditViolation {
  readonly id: string;
  readonly rows: number;
}

/** Her sorguyu koşar; satır döndürenleri listeler. Satır içeriği günlüğe yazılmaz, yalnız sayı. */
export async function runAudit(
  client: ClientBase,
  queries: readonly AuditQuery[],
  params: AuditParams,
): Promise<AuditViolation[]> {
  const violations: AuditViolation[] = [];
  for (const q of queries) {
    const values = q.params.map((name) => {
      const v = params[name];
      if (v === undefined) throw new Error(`denetim parametresi eksik: ${name} (${q.id})`);
      return v;
    });
    const res = await client.query(q.sql, values as unknown[]);
    if ((res.rowCount ?? res.rows.length) > 0) violations.push({ id: q.id, rows: res.rows.length });
  }
  return violations;
}

/** Denetimi koşar ve ihlalde `MigrateError(50)` fırlatır. */
export async function auditOrFail(
  client: ClientBase,
  queries: readonly AuditQuery[],
  params: AuditParams,
  log: MigrateLogger,
): Promise<void> {
  const violations = await runAudit(client, queries, params);
  for (const v of violations) {
    log.write({ level: 'error', event: 'audit.violation', check: v.id, rows: v.rows });
  }
  if (violations.length > 0) {
    throw new MigrateError(
      EXIT.audit,
      `denetim sorguları satır döndürdü: ${violations.map((v) => v.id).join(', ')}`,
    );
  }
  log.write({ level: 'info', event: 'audit.ok', count: queries.length });
}
