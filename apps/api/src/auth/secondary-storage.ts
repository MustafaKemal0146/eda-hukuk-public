// Better Auth ikincil depolaması (042 §2.5; 002 §18): ana `valkey`, önek `eda:auth:`, ACL kullanıcısı
// `eda_api`. Oturum kaydı kullanıcı satırını içerir (Valkey'e PII yazma kuralının tek istisnası);
// doğrulama belirteçleri `verification.storeIdentifier: 'hashed'` ile özetlenmiş anahtardadır.
// TTL saniyedir.
import type { Redis } from 'ioredis';

export const AUTH_KEY_PREFIX = 'eda:auth:';

export interface SecondaryStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  getAndDelete(key: string): Promise<string | null>;
  increment(key: string, ttl: number): Promise<number>;
}

export function valkeySecondaryStorage(redis: Redis): SecondaryStorage {
  const k = (key: string) => `${AUTH_KEY_PREFIX}${key}`;
  return {
    get: (key) => redis.get(k(key)),
    async set(key, value, ttl) {
      if (ttl !== undefined && ttl > 0) await redis.set(k(key), value, 'EX', Math.ceil(ttl));
      else await redis.set(k(key), value);
    },
    async delete(key) {
      await redis.del(k(key));
    },
    getAndDelete: (key) => redis.getdel(k(key)),
    async increment(key, ttl) {
      const n = await redis.incr(k(key));
      if (n === 1 && ttl > 0) await redis.expire(k(key), Math.ceil(ttl));
      return n;
    },
  };
}

/** TOTP tekrar kullanım engeli (042 §5.2; 002 §18 `eda:auth:totp-used:<userId>:<sha256>`). */
export const TOTP_USED_PREFIX = `${AUTH_KEY_PREFIX}totp-used:`;

export interface ReplayGuard {
  /** Anahtarı `SET NX EX` ile işaretler; daha önce işaretliyse false. Valkey yoksa fırlatır. */
  claim(key: string, ttlSec: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export function valkeyReplayGuard(redis: Redis): ReplayGuard {
  return {
    async claim(key, ttlSec) {
      const r = await redis.set(`${TOTP_USED_PREFIX}${key}`, '1', 'EX', ttlSec, 'NX');
      return r === 'OK';
    },
    async release(key) {
      await redis.del(`${TOTP_USED_PREFIX}${key}`).catch(() => 0);
    },
  };
}
