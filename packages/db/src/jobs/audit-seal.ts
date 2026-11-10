// `audit.seal` (043 §10.2; KK-043-12 DB kısmı, TK-26): dakikalık Merkle mührü + zincir doğrulaması.
// Zincir başına (büro `org_id` + platform `NULL`) pencere [önceki mührün period_end, now − audit.sealLagMin)
// dakika sınırına yuvarlanır; satır yoksa mühür yazılmaz. Yapraklar (created_at, id) sırasıyla. INSERT
// `ON CONFLICT (chain_key, period_start) DO NOTHING` ve zincir başına işlem danışma kilidi: çift/eşzamanlı
// koşu tek mühür üretir. Doğrulama son `audit.verifyLastSeals` mühürde satır sayısını, kökü, mühür
// özetini ve `prev_seal_hash` bağını yeniden hesaplar. Her sorgu açık zincir filtresi taşır; eda_jobs
// yalnız tanımlı kolonları okur (Q10). Mühür içeriksizdir (yalnız özetler ve sayılar).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { type AuditLeafRow, leafHash, merkleRoot, sealHash } from '../audit/merkle.ts';
import type { JobsDb, JobsQueryable } from './db.ts';

export const PLATFORM_CHAIN = 'platform';
const MINUTE_MS = 60_000;

export interface AuditSealOptions {
  /** Saat (test: sahte saat). */
  readonly now?: () => Date;
  readonly lagMin?: number;
}

export interface AuditSealResult {
  readonly chains: number;
  readonly sealed: number;
  readonly rows: number;
}

export interface SealMismatch {
  readonly chainKey: string;
  readonly sealId: string;
  readonly reason: 'row_count' | 'merkle_root' | 'seal_hash' | 'prev_link';
}

export interface AuditVerifyOptions {
  readonly lastSeals?: number;
}

export interface AuditVerifyResult {
  readonly checked: number;
  readonly mismatches: readonly SealMismatch[];
}

const floorMinute = (ms: number): number => Math.floor(ms / MINUTE_MS) * MINUTE_MS;
const chainKeyOf = (orgId: string | null): string => orgId ?? PLATFORM_CHAIN;

/** UTC mikro saniyeli ISO-8601 (merkle.ts kodlaması; JS Date mikro saniyeyi taşımaz). */
const LEAF_COLUMNS = `id::text AS id,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
  org_id::text AS org_id, actor_type, actor_id::text AS actor_id, action, target_type, target_id,
  metadata`;

/** Zincirin yaprakları: açık zincir filtresi (`org_id = $1` veya platform için `IS NULL`). */
async function leafRows(
  q: JobsQueryable,
  orgId: string | null,
  from: Date,
  to: Date,
): Promise<AuditLeafRow[]> {
  const res =
    orgId === null
      ? await q.query<AuditLeafRow>(
          `SELECT ${LEAF_COLUMNS} FROM app.audit_log
           WHERE org_id IS NULL AND created_at >= $1 AND created_at < $2
           ORDER BY created_at, id`,
          [from, to],
        )
      : await q.query<AuditLeafRow>(
          `SELECT ${LEAF_COLUMNS} FROM app.audit_log
           WHERE org_id = $1 AND created_at >= $2 AND created_at < $3
           ORDER BY created_at, id`,
          [orgId, from, to],
        );
  return res.rows;
}

interface LastSeal {
  readonly period_end: Date;
  readonly seal_hash: Buffer;
}

async function lastSeal(q: JobsQueryable, chainKey: string): Promise<LastSeal | undefined> {
  const r = await q.query<LastSeal>(
    `SELECT period_end, seal_hash FROM app.audit_seals
     WHERE chain_key = $1 ORDER BY period_start DESC LIMIT 1`,
    [chainKey],
  );
  return r.rows[0];
}

/**
 * Mühürlenecek zincirler: kesim anından önce, zincirin son mührünün bitişinden sonra satırı olan
 * büro/platform kimlikleri.
 */
async function pendingChains(q: JobsQueryable, cutoff: Date): Promise<(string | null)[]> {
  const r = await q.query<{ org_id: string | null }>(
    `WITH last AS (
       SELECT chain_key, max(period_end) AS period_end FROM app.audit_seals GROUP BY chain_key
     )
     SELECT a.org_id::text AS org_id
     FROM app.audit_log a
     LEFT JOIN last l ON l.chain_key = coalesce(a.org_id::text, '${PLATFORM_CHAIN}')
     WHERE a.created_at < $1 AND (l.period_end IS NULL OR a.created_at >= l.period_end)
     GROUP BY a.org_id`,
    [cutoff],
  );
  return r.rows.map((row) => row.org_id);
}

/** Tek zinciri mühürler; yazılan mühür sayısını (0/1) ve satır sayısını döner. */
async function sealChain(
  db: JobsDb,
  orgId: string | null,
  cutoff: Date,
): Promise<{ sealed: number; rows: number }> {
  const chainKey = chainKeyOf(orgId);
  return db.transaction(async (tx) => {
    // Zincir başına işlem danışma kilidi: eşzamanlı koşular sıraya girer (ON CONFLICT ek güvence).
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('eda:audit_seal:' || $1, 0))", [
      chainKey,
    ]);
    const last = await lastSeal(tx, chainKey);
    let start: Date;
    if (last !== undefined) {
      start = last.period_end;
    } else {
      const first =
        orgId === null
          ? await tx.query<{ t: Date | null }>(
              'SELECT min(created_at) AS t FROM app.audit_log WHERE org_id IS NULL',
            )
          : await tx.query<{ t: Date | null }>(
              'SELECT min(created_at) AS t FROM app.audit_log WHERE org_id = $1',
              [orgId],
            );
      const t = first.rows[0]?.t;
      if (t === null || t === undefined) return { sealed: 0, rows: 0 };
      start = new Date(floorMinute(t.getTime()));
    }
    if (start.getTime() >= cutoff.getTime()) return { sealed: 0, rows: 0 };
    const rows = await leafRows(tx, orgId, start, cutoff);
    if (rows.length === 0) return { sealed: 0, rows: 0 };
    const root = merkleRoot(rows.map((r) => leafHash(r)));
    const hash = sealHash({
      prevSealHash: last?.seal_hash ?? null,
      merkleRoot: root,
      periodStart: start,
      periodEnd: cutoff,
      rowCount: rows.length,
      chainKey,
    });
    const ins = await tx.query(
      `INSERT INTO app.audit_seals (chain_key, org_id, period_start, period_end, row_count,
         first_row_id, last_row_id, merkle_root, prev_seal_hash, seal_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (chain_key, period_start) DO NOTHING`,
      [
        chainKey,
        orgId,
        start,
        cutoff,
        rows.length,
        rows[0]?.id,
        rows[rows.length - 1]?.id,
        root,
        last?.seal_hash ?? null,
        hash,
      ],
    );
    return { sealed: ins.rowCount ?? 0, rows: ins.rowCount ? rows.length : 0 };
  });
}

/** Bekleyen tüm zincirleri mühürler. */
export async function runAuditSeal(
  db: JobsDb,
  opts: AuditSealOptions = {},
): Promise<AuditSealResult> {
  const now = (opts.now ?? (() => new Date()))();
  const lagMin = opts.lagMin ?? CONFIG_DEFAULTS['audit.sealLagMin'];
  const cutoff = new Date(floorMinute(now.getTime() - lagMin * MINUTE_MS));
  const chains = await pendingChains(db, cutoff);
  let sealed = 0;
  let rows = 0;
  for (const orgId of chains) {
    const r = await sealChain(db, orgId, cutoff);
    sealed += r.sealed;
    rows += r.rows;
  }
  return { chains: chains.length, sealed, rows };
}

interface SealRow {
  readonly id: string;
  readonly chain_key: string;
  readonly org_id: string | null;
  readonly period_start: Date;
  readonly period_end: Date;
  readonly row_count: number;
  readonly merkle_root: Buffer;
  readonly prev_seal_hash: Buffer | null;
  readonly seal_hash: Buffer;
}

/** Son mühürleri yeniden hesaplar; uyuşmazlıkları döner (çağıran error günlüğü + sayaç yazar). */
export async function verifyAuditSeals(
  db: JobsDb,
  opts: AuditVerifyOptions = {},
): Promise<AuditVerifyResult> {
  const limit = opts.lastSeals ?? CONFIG_DEFAULTS['audit.verifyLastSeals'];
  const seals = await db.query<SealRow>(
    `SELECT id::text AS id, chain_key, org_id::text AS org_id, period_start, period_end, row_count,
            merkle_root, prev_seal_hash, seal_hash
     FROM app.audit_seals ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  const mismatches: SealMismatch[] = [];
  for (const s of seals.rows) {
    const add = (reason: SealMismatch['reason']) =>
      mismatches.push({ chainKey: s.chain_key, sealId: s.id, reason });
    const prev = await db.query<{ seal_hash: Buffer }>(
      `SELECT seal_hash FROM app.audit_seals
       WHERE chain_key = $1 AND period_start < $2 ORDER BY period_start DESC LIMIT 1`,
      [s.chain_key, s.period_start],
    );
    const expectedPrev = prev.rows[0]?.seal_hash ?? null;
    if (
      (expectedPrev === null) !== (s.prev_seal_hash === null) ||
      (expectedPrev !== null && s.prev_seal_hash !== null && !expectedPrev.equals(s.prev_seal_hash))
    ) {
      add('prev_link');
    }
    const rows = await leafRows(db, s.org_id, s.period_start, s.period_end);
    if (rows.length !== s.row_count) {
      add('row_count');
      continue;
    }
    const root = rows.length > 0 ? merkleRoot(rows.map((r) => leafHash(r))) : Buffer.alloc(32);
    if (!root.equals(s.merkle_root)) add('merkle_root');
    const hash = sealHash({
      prevSealHash: s.prev_seal_hash,
      merkleRoot: s.merkle_root,
      periodStart: s.period_start,
      periodEnd: s.period_end,
      rowCount: s.row_count,
      chainKey: s.chain_key,
    });
    if (!hash.equals(s.seal_hash)) add('seal_hash');
  }
  return { checked: seals.rows.length, mismatches };
}
