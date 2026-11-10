// Valkey indirme belirteci deposu (`valkey` ana örnek; ACL `eda_api`: `~eda:dl:*`). Değerde ad/içerik
// yoktur; anahtar belirtecin SHA-256 özetidir (033 §10.4).
import type { Redis } from 'ioredis';
import {
  DOWNLOAD_TOKEN_KEY_PREFIX,
  type DownloadTokenRecord,
  type DownloadTokenStore,
} from '../services/files/tokens.ts';

export function valkeyDownloadTokenStore(redis: Redis): DownloadTokenStore {
  return {
    async put(hash, record, ttlSec) {
      await redis.set(`${DOWNLOAD_TOKEN_KEY_PREFIX}${hash}`, JSON.stringify(record), 'EX', ttlSec);
    },
    async take(hash) {
      const raw = await redis.getdel(`${DOWNLOAD_TOKEN_KEY_PREFIX}${hash}`);
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as DownloadTokenRecord;
      } catch {
        return null;
      }
    },
  };
}
