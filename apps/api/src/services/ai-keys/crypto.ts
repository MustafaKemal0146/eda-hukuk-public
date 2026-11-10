// Yapay zekâ API anahtarı şifreleme bağlamları ve sağlayıcı doğrulayıcısı (#54 BYOK). Büro anahtarı
// büro DEK'iyle, kişisel anahtar KEK'ten türetilen kullanıcı anahtarıyla AES-256-GCM şifrelenir; AAD
// büro/kullanıcı, tablo, kolon ve sürüme bağlıdır (başka satıra taşınan şifreli değer çözülmez).
// Düz metin anahtar günlüğe, yanıta, denetim kaydına ve hata ayrıntısına YAZILMAZ.
import { hkdfSync } from 'node:crypto';
import type { FieldContext } from '@eda/crypto';

/** Sağlayıcıya yapılan doğrulama: kabul edildiyse `true`, açıkça reddedildiyse `false`; ulaşılamazsa atar. */
export type KeyVerifier = (apiKey: string) => Promise<boolean>;

const USER_KEY_INFO = 'eda/v1/user-ai-key';

/** Kullanıcı başına anahtar: HKDF-SHA256(KEK, tuz = ∅, info = etiket ‖ 0x00 ‖ kullanıcı kimliği). */
export function deriveUserKey(kek: Buffer, userId: string): Buffer {
  const info = Buffer.concat([
    Buffer.from(USER_KEY_INFO, 'ascii'),
    Buffer.from([0]),
    Buffer.from(userId, 'ascii'),
  ]);
  return Buffer.from(hkdfSync('sha256', kek, Buffer.alloc(0), info, 32));
}

const PLATFORM_KEY_INFO = 'eda/v1/platform-ai-key';

/** Platform ortak anahtarı: HKDF-SHA256(KEK, tuz = ∅, info = etiket ‖ 0x00); kullanıcı anahtarıyla aynı kalıp. */
export function derivePlatformKey(kek: Buffer): Buffer {
  const info = Buffer.concat([Buffer.from(PLATFORM_KEY_INFO, 'ascii'), Buffer.from([0])]);
  return Buffer.from(hkdfSync('sha256', kek, Buffer.alloc(0), info, 32));
}

/** Tek satırlı `platform_settings` için AAD'de kullanılan sabit 16 bayt kimlik (büro/kullanıcı kimliği değildir). */
export const PLATFORM_KEY_ROW_ID = '00000000-0000-4000-8000-0000000000a1';

/** Platform anahtarı AAD'si: tablo `platform_settings`, kolon `platform_ai_key`, sürüm = KEK sürümü. */
export const platformKeyContext = (version: number): FieldContext => ({
  orgId: PLATFORM_KEY_ROW_ID,
  table: 'platform_settings',
  rowId: PLATFORM_KEY_ROW_ID,
  column: 'platform_ai_key',
  keyVersion: version,
});

export const orgKeyContext = (orgId: string, version: number): FieldContext => ({
  orgId,
  table: 'org_settings',
  rowId: orgId,
  column: 'ai_api_key_enc',
  keyVersion: version,
});

/** Kullanıcı anahtarında `orgId` alanına kullanıcı kimliği konur (aynı 16 bayt UUID bağlaması). */
export const userKeyContext = (userId: string, version: number): FieldContext => ({
  orgId: userId,
  table: 'user_preferences',
  rowId: userId,
  column: 'ai_api_key_enc',
  keyVersion: version,
});

export const last4Of = (apiKey: string): string => apiKey.slice(-4);

/** Anthropic'e ucuz bir doğrulama çağrısı (`GET /v1/models`; çıkış vekili üzerinden). */
export function anthropicVerifier(fetchImpl: typeof fetch = fetch, timeoutMs = 8000): KeyVerifier {
  return async (apiKey) => {
    const res = await fetchImpl('https://api.anthropic.com/v1/models?limit=1', {
      method: 'GET',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 401 || res.status === 403) return false;
    if (res.ok) return true;
    throw new Error(`sağlayıcı yanıtı: ${res.status}`);
  };
}
