// Platform ayarı kaynağı: sohbet yolu, ayarları ve şifreli platform anahtarını
// `app.platform_settings_runtime()` ile okur (EXECUTE yalnız `eda_readonly_admin`; uygulama rolleri
// `app.platform_settings` tablosuna erişemez). Bu dosya yönetim havuzunu kullandığı için `admin/` altındadır.
// Çözme işi KEK'i tutan API sürecindedir (`services/ai-keys/platform-settings.ts`).

import type { PlatformSettingsRow } from '../services/ai-keys/platform-settings.ts';
import type { AdminDb } from './db.ts';

const nOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function createPlatformSettingsLoader(db: Pick<AdminDb, 'withAdmin'>) {
  return async (): Promise<PlatformSettingsRow> => {
    const r = await db.withAdmin((tx) => tx.query('SELECT * FROM app.platform_settings_runtime()'));
    const x = r.rows[0] as Record<string, unknown> | undefined;
    if (x === undefined) throw new Error('platform ayarı satırı yok');
    return {
      keyEnc: Buffer.isBuffer(x.key_enc) ? x.key_enc : null,
      keyVersion: nOrNull(x.key_version),
      keyLabel: typeof x.key_label === 'string' ? x.key_label : null,
      keyLast4: typeof x.key_last4 === 'string' ? x.key_last4 : null,
      fallbackEnabled: x.fallback_enabled === true,
      userTurnsPerDay: nOrNull(x.user_turns_per_day),
      userTokensPerDay: nOrNull(x.user_tokens_per_day),
      orgDailyCapMicroUsd: nOrNull(x.org_daily_cap_micro_usd),
      platformDailyCapMicroUsd: nOrNull(x.platform_daily_cap_micro_usd),
    };
  };
}
