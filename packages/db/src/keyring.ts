// Büro anahtarlığı (033 §4.7, §5.1): `app.org_keys` satırından büro DEK'ini KEK ile açar. Çağıran
// kendi `withTenant` işleminin `tx`'ini verir (RLS: yalnız kendi büronun anahtar satırı). Açılmış DEK
// süreç belleğinde LRU 256 büro / TTL 300 sn tutulur; her çağrı çağırana ÖZEL bir kopya döner, böylece
// çağıran işi bitince `wipe` edebilir. Anahtar log, hata, metrik ve denetim kaydına yazılmaz.
// DEK imha edildiyse (`shredded`) veya satır yoksa 503 `INTERNAL_DEPENDENCY_UNAVAILABLE` (reason
// `storage`): o büronun evrakı çözülemez.
import { AppError } from '@eda/contracts/errors';
import { type KekMaterial, unwrapDek, wipe } from '@eda/crypto';
import type { TenantTx } from './tenant.ts';

export const DEK_CACHE_MAX_ORGS = 256;
export const DEK_CACHE_TTL_MS = 300_000;
const RETRY_AFTER_SEC = 5;

export interface OrgDek {
  /** Çağırana özel kopya; iş bitince `wipe(dek)` çağrılmalıdır. */
  readonly dek: Buffer;
  /** `org_keys.key_version`. */
  readonly keyVersion: number;
}

export interface Keyring {
  /** Yeni dosyalar için etkin DEK. */
  activeDek(tx: TenantTx, orgId: string): Promise<OrgDek>;
  /** Belirli sürümdeki DEK (`files.wrap_dek_version`; döndürme sonrası eski sürüm). */
  dekByVersion(tx: TenantTx, orgId: string, version: number): Promise<OrgDek>;
  /** Önbelleği boşaltır ve tamponları sıfırlar (kapanış, test). */
  clear(): void;
}

export interface KeyringOptions {
  /** Çalışan KEK (ve döndürme sırasında önceki KEK); `org_keys.kek_version` doğru olanı seçer. */
  readonly keks: readonly KekMaterial[];
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly maxOrgs?: number;
}

interface DekRow {
  readonly wrapped: Buffer;
  readonly keyVersion: number;
  readonly kekVersion: number;
}

interface CacheEntry {
  readonly dek: Buffer;
  readonly expiresAt: number;
}

const unavailable = (): AppError<'INTERNAL_DEPENDENCY_UNAVAILABLE'> =>
  new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE', {
    reason: 'storage',
    meta: { retryAfterSec: RETRY_AFTER_SEC },
  });

function rowOf(r: Record<string, unknown> | undefined): DekRow | null {
  if (r === undefined || !Buffer.isBuffer(r.wrapped_dek)) return null;
  return {
    wrapped: r.wrapped_dek,
    keyVersion: Number(r.key_version),
    kekVersion: Number(r.kek_version),
  };
}

async function readActive(tx: TenantTx, orgId: string): Promise<DekRow | null> {
  const r = await tx.query(
    `SELECT wrapped_dek, key_version, kek_version FROM app.org_keys
      WHERE org_id = $1 AND status = 'active' ORDER BY key_version DESC LIMIT 1`,
    [orgId],
  );
  return rowOf(r.rows[0] as Record<string, unknown> | undefined);
}

/** İmha edilmiş (`shredded`) anahtar dönmez (033 §5.1). */
async function readVersion(tx: TenantTx, orgId: string, version: number): Promise<DekRow | null> {
  const r = await tx.query(
    `SELECT wrapped_dek, key_version, kek_version FROM app.org_keys
      WHERE org_id = $1 AND key_version = $2 AND status <> 'shredded'`,
    [orgId, version],
  );
  return rowOf(r.rows[0] as Record<string, unknown> | undefined);
}

export function createKeyring(options: KeyringOptions): Keyring {
  const now = options.now ?? (() => Date.now());
  const ttl = options.ttlMs ?? DEK_CACHE_TTL_MS;
  const max = options.maxOrgs ?? DEK_CACHE_MAX_ORGS;
  const keks = new Map(options.keks.map((k) => [k.kekVersion, k.kek]));
  // Map ekleme sırası = LRU sırası (okumada yeniden eklenir).
  const cache = new Map<string, CacheEntry>();

  const evict = (key: string): void => {
    const e = cache.get(key);
    if (e !== undefined) wipe(e.dek);
    cache.delete(key);
  };

  const lookup = (key: string): Buffer | null => {
    const e = cache.get(key);
    if (e === undefined) return null;
    if (e.expiresAt <= now()) {
      evict(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, e);
    return Buffer.from(e.dek);
  };

  const store = (key: string, dek: Buffer): void => {
    evict(key);
    cache.set(key, { dek: Buffer.from(dek), expiresAt: now() + ttl });
    while (cache.size > max) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      evict(oldest);
    }
  };

  const open = (orgId: string, row: DekRow): OrgDek => {
    const key = `${orgId}:${row.keyVersion}:${row.kekVersion}`;
    const hit = lookup(key);
    if (hit !== null) return { dek: hit, keyVersion: row.keyVersion };
    const kek = keks.get(row.kekVersion);
    if (kek === undefined) throw unavailable();
    let dek: Buffer;
    try {
      dek = unwrapDek(
        kek,
        { orgId, dekVersion: row.keyVersion, kekVersion: row.kekVersion },
        row.wrapped,
      );
    } catch {
      throw unavailable();
    }
    store(key, dek);
    return { dek, keyVersion: row.keyVersion };
  };

  return {
    async activeDek(tx, orgId) {
      const row = await readActive(tx, orgId);
      if (row === null) throw unavailable();
      return open(orgId, row);
    },
    async dekByVersion(tx, orgId, version) {
      // Önbellek isabeti DB'ye gitmeden döner (TTL ≤ 300 sn kabulü; 033 §4.7).
      for (const kekVersion of keks.keys()) {
        const hit = lookup(`${orgId}:${version}:${kekVersion}`);
        if (hit !== null) return { dek: hit, keyVersion: version };
      }
      const row = await readVersion(tx, orgId, version);
      if (row === null) throw unavailable();
      return open(orgId, row);
    },
    clear() {
      for (const key of [...cache.keys()]) evict(key);
    },
  };
}
