// Tek kullanımlık indirme belirteci (033 §10.4): 32 bayt CSPRNG, base64url (43 karakter). Valkey'de
// yalnız SHA-256 özeti anahtar olur (`eda:dl:<sha256(belirteç)>`); HAM belirteç saklanmaz. Değer yalnız
// kimlikleri taşır. Tüketim `GETDEL` ile atomiktir: ikinci kullanım, süre aşımı, farklı kullanıcı/oturum/
// hedef `AUTH_FORBIDDEN` (`download_token_invalid`). Belirteç YETKİ VERMEZ: niyet kanıtıdır; oturum
// çerezi ve dosya yetkisi her indirmede yeniden denetlenir.
import { createHash, randomBytes } from 'node:crypto';
import type { FileDownloadVariant } from '@eda/contracts/api/files';

export interface DownloadTokenRecord {
  readonly userId: string;
  readonly orgId: string;
  readonly targetType: 'file';
  readonly targetId: string;
  readonly variant: FileDownloadVariant;
  readonly sessionId: string;
}

export interface DownloadTokenStore {
  /** `ttlSec` sonra kendiliğinden silinir. */
  put(hash: string, record: DownloadTokenRecord, ttlSec: number): Promise<void>;
  /** Atomik oku-ve-sil (`GETDEL`); yoksa veya süresi dolduysa `null`. */
  take(hash: string): Promise<DownloadTokenRecord | null>;
}

export const DOWNLOAD_TOKEN_KEY_PREFIX = 'eda:dl:';

export function newDownloadToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Valkey anahtarının özet kısmı (küçük harf onaltılık). */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sameRecord(a: DownloadTokenRecord, b: DownloadTokenRecord): boolean {
  return (
    a.userId === b.userId &&
    a.orgId === b.orgId &&
    a.targetType === b.targetType &&
    a.targetId === b.targetId &&
    a.variant === b.variant &&
    a.sessionId === b.sessionId
  );
}
