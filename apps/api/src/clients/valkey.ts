// `valkey` (kuyruk/hız sınırı/oturum örneği; noeviction) bağlantıları (002 §18; 040 §12.1; 043 §2.3).
// ACL kullanıcısı `eda_api` (`~eda:bull:* ~eda:rl:* ~eda:auth:* …`). Parola yalnız dosyadan okunur.
// Komut bağlantısı (hız sınırı, Better Auth ikincil depolama) ve BullMQ üretici bağlantısı ayrıdır;
// üreticide `enableOfflineQueue: false` + `maxRetriesPerRequest: 1` (Valkey yoksa ekleme hemen hata).
import { readFileSync } from 'node:fs';
import { Redis } from 'ioredis';

export interface ValkeyTarget {
  readonly url: string;
  readonly username: string;
  readonly passwordFile: string;
}

export function createValkeyClient(t: ValkeyTarget, connectionName: string): Redis {
  return new Redis(t.url, {
    username: t.username,
    password: readFileSync(t.passwordFile, 'utf8').trim(),
    connectionName,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
  });
}
