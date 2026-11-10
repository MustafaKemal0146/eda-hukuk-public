// `@eda/db/canary` (021 §7.3): `source_status.canary` işinin `corpus.source_canary_runs` erişimi. Tablo
// kiracısızdır (corpus, RLS YOK); worker `withNoTenant('corpus')` içinde çağırır. Sorgular parametrelidir;
// satırda sorgu metni veya yanıt içeriği yoktur.
import type { SourceCanaryOutcome, SourceCanaryProbe, SourceCode } from '@eda/contracts/enums';
import { sourceCanaryRuns } from './schema/corpus.ts';
import type { NoTenantTx } from './tenant.ts';

export interface CanaryRunRow {
  readonly probe: SourceCanaryProbe;
  readonly outcome: SourceCanaryOutcome;
  readonly durationMs: number;
  readonly checkedAt: Date;
}

/** Yoklama başına en yeni `limit` sonuç (yeniden eskiye). */
export async function recentCanaryOutcomes(
  tx: NoTenantTx,
  limit: number,
): Promise<Map<string, SourceCanaryOutcome[]>> {
  const r = await tx.query<{ probe: string; outcome: SourceCanaryOutcome }>(
    `SELECT probe, outcome FROM (
       SELECT probe, outcome, checked_at,
              row_number() OVER (PARTITION BY probe ORDER BY checked_at DESC, id DESC) AS rn
       FROM corpus.source_canary_runs
     ) x WHERE rn <= $1 ORDER BY probe, checked_at DESC, rn`,
    [limit],
  );
  const out = new Map<string, SourceCanaryOutcome[]>();
  for (const row of r.rows) {
    const list = out.get(row.probe) ?? [];
    list.push(row.outcome);
    out.set(row.probe, list);
  }
  return out;
}

export async function insertCanaryRuns(
  tx: NoTenantTx,
  rows: readonly CanaryRunRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.db.insert(sourceCanaryRuns).values(
    rows.map((row) => ({
      probe: row.probe,
      outcome: row.outcome,
      durationMs: Math.max(0, Math.round(row.durationMs)),
      checkedAt: row.checkedAt,
    })),
  );
}

/** Pencere dışındaki satırları siler; silinen satır sayısı. */
export async function purgeCanaryRuns(tx: NoTenantTx, olderThan: Date): Promise<number> {
  const r = await tx.query('DELETE FROM corpus.source_canary_runs WHERE checked_at < $1', [
    olderThan,
  ]);
  return r.rowCount ?? 0;
}

/**
 * `corpus.source_status.last_canary_at/ok` (021 §5.14 eşlemesi). Satır yoksa yazılmaz (satırı
 * `source_status.snapshot` oluşturur); güncellenen satır sayısı döner.
 */
export async function markSourceCanary(
  tx: NoTenantTx,
  source: SourceCode,
  at: Date,
  ok: boolean,
): Promise<number> {
  const r = await tx.query(
    'UPDATE corpus.source_status SET last_canary_at = $2, last_canary_ok = $3 WHERE source = $1',
    [source, at, ok],
  );
  return r.rowCount ?? 0;
}
