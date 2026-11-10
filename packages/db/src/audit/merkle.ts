// Denetim kaydı Merkle mührü (043 §10.2; 002 §22). Saf: yalnız node:crypto.
//   yaprak   = SHA-256(0x00 ‖ kanonik JSON{id, created_at, org_id, actor_type, actor_id, action,
//              target_type, target_id, metadata})  (anahtarlar sıralı, boşluksuz, UTF-8)
//   iç düğüm = SHA-256(0x01 ‖ sol ‖ sağ)  (RFC 6962 biçimi; eşi olmayan son düğüm bir üst düzeye taşınır)
//   seal_hash = SHA-256(prev_seal_hash ‖ merkle_root ‖ period_start ‖ period_end ‖ row_count ‖ chain_key)
// Kodlama kararları: `created_at` UTC ISO-8601 mikro saniyeli (`YYYY-MM-DDTHH:MM:SS.ffffffZ`);
// ilk mühürde prev_seal_hash 32 sıfır bayt; dönem sınırları int64 BE Unix milisaniye; row_count uint32
// BE; chain_key UTF-8 (son alan, uzunluksuz).
import { createHash } from 'node:crypto';

export interface AuditLeafRow {
  readonly id: string;
  /** UTC, mikro saniyeli ISO-8601 (`2026-10-11T10:00:00.123456Z`). */
  readonly created_at: string;
  readonly org_id: string | null;
  readonly actor_type: string;
  readonly actor_id: string | null;
  readonly action: string;
  readonly target_type: string | null;
  readonly target_id: string | null;
  readonly metadata: unknown;
}

const HASH_BYTES = 32;
const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

/** Anahtarları özyinelemeli sıralı, boşluksuz JSON. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const s = JSON.stringify(value);
    if (s === undefined) throw new TypeError('kanonik JSON: desteklenmeyen değer');
    return s;
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

const sha256 = (...parts: Uint8Array[]): Buffer => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
};

export function leafHash(row: AuditLeafRow): Buffer {
  const doc = {
    id: row.id,
    created_at: row.created_at,
    org_id: row.org_id,
    actor_type: row.actor_type,
    actor_id: row.actor_id,
    action: row.action,
    target_type: row.target_type,
    target_id: row.target_id,
    metadata: row.metadata,
  };
  return sha256(LEAF_PREFIX, Buffer.from(canonicalJson(doc), 'utf8'));
}

/** Yaprak özetlerinden kök; boş liste için hata (satırsız pencerede mühür yazılmaz). */
export function merkleRoot(leaves: readonly Uint8Array[]): Buffer {
  if (leaves.length === 0) throw new RangeError('Merkle kökü için en az bir yaprak gerekir');
  let level: Buffer[] = leaves.map((l) => Buffer.from(l));
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as Buffer;
      const right = level[i + 1];
      next.push(right === undefined ? left : sha256(NODE_PREFIX, left, right));
    }
    level = next;
  }
  return level[0] as Buffer;
}

export interface SealInput {
  readonly prevSealHash: Uint8Array | null;
  readonly merkleRoot: Uint8Array;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly rowCount: number;
  readonly chainKey: string;
}

function int64(ms: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigInt64BE(BigInt(ms));
  return b;
}

export function sealHash(s: SealInput): Buffer {
  if (s.merkleRoot.length !== HASH_BYTES) throw new RangeError('merkle_root 32 bayt olmalı');
  const prev = s.prevSealHash ?? Buffer.alloc(HASH_BYTES);
  if (prev.length !== HASH_BYTES) throw new RangeError('prev_seal_hash 32 bayt olmalı');
  const count = Buffer.alloc(4);
  count.writeUInt32BE(s.rowCount);
  return sha256(
    prev,
    s.merkleRoot,
    int64(s.periodStart.getTime()),
    int64(s.periodEnd.getTime()),
    count,
    Buffer.from(s.chainKey, 'utf8'),
  );
}
