// Yapay zekâ API anahtarı deposu (#54 BYOK): `app.org_settings` ve `app.user_preferences` anahtar
// kolonları. Şifreli değer (`*_enc`) yalnız bu dosyadan okunur/yazılır; SQL yalnız burada. Düz metin
// anahtar bu katmana HİÇ girmez: çağıran şifreli bayt dizisini verir.
import type { TenantTx, UserTx } from '@eda/db';

export interface KeySlotRow {
  readonly enc: Buffer | null;
  readonly last4: string | null;
  readonly version: number | null;
  readonly verifiedAt: Date | null;
}

const EMPTY: KeySlotRow = { enc: null, last4: null, version: null, verifiedAt: null };

function slotOf(row: Record<string, unknown> | undefined): KeySlotRow {
  if (!row) return EMPTY;
  return {
    enc: Buffer.isBuffer(row.enc) ? row.enc : null,
    last4: typeof row.last4 === 'string' ? row.last4 : null,
    version: typeof row.version === 'number' ? row.version : null,
    verifiedAt: row.verified_at instanceof Date ? row.verified_at : null,
  };
}

export async function readOrgSlot(tx: TenantTx, orgId: string): Promise<KeySlotRow> {
  const r = await tx.query(
    `SELECT ai_api_key_enc AS enc, ai_api_key_last4 AS last4, ai_api_key_version AS version,
            ai_api_key_verified_at AS verified_at
       FROM app.org_settings WHERE org_id = $1`,
    [orgId],
  );
  return slotOf(r.rows[0] as Record<string, unknown> | undefined);
}

/** Etkin büro DEK'i (KEK ile sarılı). Yoksa `null` (büro anahtarı kurulmamış). */
export async function readActiveDek(
  tx: TenantTx,
  orgId: string,
): Promise<{ wrapped: Buffer; keyVersion: number; kekVersion: number } | null> {
  const r = await tx.query(
    `SELECT wrapped_dek, key_version, kek_version FROM app.org_keys
      WHERE org_id = $1 AND status = 'active' ORDER BY key_version DESC LIMIT 1`,
    [orgId],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row || !Buffer.isBuffer(row.wrapped_dek)) return null;
  return {
    wrapped: row.wrapped_dek,
    keyVersion: Number(row.key_version),
    kekVersion: Number(row.kek_version),
  };
}

/**
 * Belirli sürümdeki büro DEK'i (rotasyon sonrası eski sürümle şifrelenmiş alanlar için). İmha edilmiş
 * (`shredded`) anahtar dönmez: o sürümle şifrelenen veri artık çözülemez.
 */
export async function readDekVersion(
  tx: TenantTx,
  orgId: string,
  version: number,
): Promise<{ wrapped: Buffer; keyVersion: number; kekVersion: number } | null> {
  const r = await tx.query(
    `SELECT wrapped_dek, key_version, kek_version FROM app.org_keys
      WHERE org_id = $1 AND key_version = $2 AND status <> 'shredded'`,
    [orgId, version],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  if (!row || !Buffer.isBuffer(row.wrapped_dek)) return null;
  return {
    wrapped: row.wrapped_dek,
    keyVersion: Number(row.key_version),
    kekVersion: Number(row.kek_version),
  };
}

/** Anahtarı yazar (veya `null` ile siler); güncellenen satır sayısını döner. */
export async function writeOrgSlot(
  tx: TenantTx,
  orgId: string,
  userId: string,
  v: { enc: Buffer; last4: string; version: number; verifiedAt: Date } | null,
): Promise<number> {
  const r = await tx.query(
    `UPDATE app.org_settings
        SET ai_api_key_enc = $3, ai_api_key_last4 = $4, ai_api_key_version = $5,
            ai_api_key_verified_at = $6, updated_by = $2
      WHERE org_id = $1`,
    [orgId, userId, v?.enc ?? null, v?.last4 ?? null, v?.version ?? null, v?.verifiedAt ?? null],
  );
  return r.rowCount ?? 0;
}

export interface UserKeyRow extends KeySlotRow {
  readonly source: 'org' | 'own';
}

export async function readUserSlot(tx: UserTx, userId: string): Promise<UserKeyRow> {
  const r = await tx.query(
    `SELECT ai_key_source AS source, ai_api_key_enc AS enc, ai_api_key_last4 AS last4,
            ai_api_key_version AS version, ai_api_key_verified_at AS verified_at
       FROM app.user_preferences WHERE user_id = $1`,
    [userId],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return { ...slotOf(row), source: row?.source === 'own' ? 'own' : 'org' };
}

/** Kullanıcı satırı yoksa açar; yalnız verilen alanları günceller (kaynak ve/veya kendi anahtarı). */
export async function upsertUserSlot(
  tx: UserTx,
  userId: string,
  v: {
    source?: 'org' | 'own';
    key?: { enc: Buffer; last4: string; version: number; verifiedAt: Date } | null;
  },
): Promise<void> {
  await tx.query(`INSERT INTO app.user_preferences (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [
    userId,
  ]);
  if (v.source !== undefined) {
    await tx.query(`UPDATE app.user_preferences SET ai_key_source = $2 WHERE user_id = $1`, [
      userId,
      v.source,
    ]);
  }
  if (v.key !== undefined) {
    await tx.query(
      `UPDATE app.user_preferences
          SET ai_api_key_enc = $2, ai_api_key_last4 = $3, ai_api_key_version = $4,
              ai_api_key_verified_at = $5
        WHERE user_id = $1`,
      [
        userId,
        v.key?.enc ?? null,
        v.key?.last4 ?? null,
        v.key?.version ?? null,
        v.key?.verifiedAt ?? null,
      ],
    );
  }
}
