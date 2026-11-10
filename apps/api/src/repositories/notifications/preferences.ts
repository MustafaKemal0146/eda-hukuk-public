// `app.notification_preferences` deposu (045 §13.1). Kullanıcı düzeyi seyrek geçersiz kılma tablosu;
// satır yoksa varsayılan geçerlidir. Her fonksiyon çağıranın kullanıcı bağlamlı işlemini alır
// (`withUserScope`); RLS yalnız kendi satırlarını gösterir. SQL yalnız burada yazılır.
import type { ChannelOverride } from '@eda/contracts/notifications';
import type { UserTx } from '@eda/db';

export async function listOverrides(tx: UserTx, userId: string): Promise<ChannelOverride[]> {
  const r = await tx.query(
    `SELECT kind, channel, enabled FROM app.notification_preferences
      WHERE user_id = $1 ORDER BY kind, channel`,
    [userId],
  );
  return r.rows.map((x) => {
    const row = x as { kind: string; channel: string; enabled: boolean };
    return {
      kind: row.kind as ChannelOverride['kind'],
      channel: row.channel as ChannelOverride['channel'],
      enabled: row.enabled,
    };
  });
}

/** Geçersiz kılmaları yazar (upsert); aynı anahtar için son değer kazanır. */
export async function upsertOverrides(
  tx: UserTx,
  userId: string,
  overrides: readonly ChannelOverride[],
): Promise<void> {
  for (const o of overrides) {
    await tx.query(
      `INSERT INTO app.notification_preferences (user_id, kind, channel, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, kind, channel)
       DO UPDATE SET enabled = EXCLUDED.enabled`,
      [userId, o.kind, o.channel, o.enabled],
    );
  }
}
