// Hız sınırı (040 §5.7; 042 §11): Valkey'de tek Lua betiğiyle GCRA (`EVALSHA`), anahtar
// `eda:rl:<kapsam>:<kimlik>`, aşımda 429 `RATE_LIMITED` + `Retry-After`. Kimlik uçlarında (`auth-ip`,
// `auth-account`) Valkey yokken fail-closed 503; kullanıcı kapsamlarında süreç içi sabit pencere yedeği
// (en çok 10.000 anahtar) + `eda_rate_limit_fallback_total`. E-posta kimliği HMAC ile anahtarlanır.
import { createHmac } from 'node:crypto';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { Redis } from 'ioredis';
import { ipBucket } from '../auth/net.ts';

export const RL_PREFIX = 'eda:rl:';
export const RATE_SCOPES = [
  'auth-ip',
  'api-user',
  'chat-user',
  'kvkk-preview',
  'auth-account',
  'auth-email-out',
  'step-up',
  'admin-auth-ip',
  'auth-email-ip',
  'auth-email-global',
] as const;
export type RateScope = (typeof RATE_SCOPES)[number];

/** Valkey yokken reddedilen kapsamlar (fail-closed). */
const FAIL_CLOSED: ReadonlySet<RateScope> = new Set([
  'auth-ip',
  'auth-account',
  'admin-auth-ip',
  'auth-email-ip',
  'auth-email-global',
]);
const REASON: Readonly<Partial<Record<RateScope, string>>> = {
  'auth-ip': 'auth_ip',
  'admin-auth-ip': 'auth_ip',
  'auth-email-ip': 'auth_ip',
  'api-user': 'api_user',
  'chat-user': 'chat_user',
  'kvkk-preview': 'kvkk_preview',
  'auth-account': 'auth_account',
  'step-up': 'step_up',
};
const FALLBACK_MAX_KEYS = 10_000;
/** Hesap başına hatırlanan "bilinen ağ öneki" üst sınırı (bellek sınırı; yapısal, ölçüm değil). */
const KNOWN_PREFIXES_MAX = 20;
const DAY_MS = 86_400_000;

/**
 * GCRA: emisyon aralığı T = pencere / limit, tolerans = pencere (patlama = limit). Dönüş
 * `{izin, bekleme_ms}`. Zaman çağırandan gelir (sahte saatle test edilebilir).
 */
export const GCRA_LUA = `
local now = tonumber(ARGV[1])
local t = tonumber(ARGV[2])
local tol = tonumber(ARGV[3])
local tat = tonumber(redis.call('GET', KEYS[1]) or now)
if tat < now then tat = now end
local new_tat = tat + t
local allow_at = new_tat - tol
if allow_at > now then
  return {0, math.ceil(allow_at - now)}
end
redis.call('SET', KEYS[1], new_tat, 'PX', math.ceil(new_tat - now))
return {1, 0}
`;

export interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterSec: number;
}

export interface RateLimiterOptions {
  readonly redis: Redis;
  readonly hmacKey: Buffer;
  readonly now?: () => number;
  readonly onFallback?: () => void;
  /**
   * Hesap başına küresel başarısız deneme eşiği (`auth.accountGlobalFailureThreshold`) aşıldığında
   * bir kez çağrılır (denetim kaydı için; kimlik açık yazılmaz).
   */
  readonly onGlobalThreshold?: (info: { ip: string }) => void;
}

type GcraRedis = Redis & {
  edaGcra(key: string, now: number, t: number, tol: number): Promise<[number, number]>;
};

export class RateLimiter {
  readonly #redis: GcraRedis;
  readonly #hmacKey: Buffer;
  readonly #now: () => number;
  readonly #onFallback: () => void;
  readonly #onGlobalThreshold: (info: { ip: string }) => void;
  readonly #fallback = new Map<string, { count: number; resetAt: number }>();

  constructor(opts: RateLimiterOptions) {
    const r = opts.redis as GcraRedis;
    if (typeof (r as Partial<GcraRedis>).edaGcra !== 'function') {
      r.defineCommand('edaGcra', { numberOfKeys: 1, lua: GCRA_LUA });
    }
    this.#redis = r;
    this.#hmacKey = opts.hmacKey;
    this.#now = opts.now ?? Date.now;
    this.#onFallback = opts.onFallback ?? (() => undefined);
    this.#onGlobalThreshold = opts.onGlobalThreshold ?? (() => undefined);
  }

  /** E-posta adresinin anahtar kimliği (HMAC-SHA256, `hmac_pseudonym_key`; açık adres yazılmaz). */
  pseudonym(value: string): string {
    return createHmac('sha256', this.#hmacKey).update(value).digest('base64url').slice(0, 32);
  }

  /** `limit` istek / `windowMs`. */
  async check(
    scope: RateScope,
    id: string,
    limit: number,
    windowMs: number,
  ): Promise<RateDecision> {
    const key = `${RL_PREFIX}${scope}:${id}`;
    const now = this.#now();
    try {
      const [ok, waitMs] = await this.#redis.edaGcra(key, now, windowMs / limit, windowMs);
      return { allowed: ok === 1, retryAfterSec: Math.max(1, Math.ceil(waitMs / 1000)) };
    } catch {
      if (FAIL_CLOSED.has(scope)) throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE');
      this.#onFallback();
      return this.#fallbackCheck(key, limit, windowMs, now);
    }
  }

  /** Aşımda 429 fırlatır. */
  async enforce(scope: RateScope, id: string, limit: number, windowMs: number): Promise<void> {
    const d = await this.check(scope, id, limit, windowMs);
    if (!d.allowed) throw rateLimited(scope, d.retryAfterSec, limit);
  }

  #fallbackCheck(key: string, limit: number, windowMs: number, now: number): RateDecision {
    const cur = this.#fallback.get(key);
    if (cur === undefined || cur.resetAt <= now) {
      if (this.#fallback.size >= FALLBACK_MAX_KEYS) {
        const oldest = this.#fallback.keys().next().value;
        if (oldest !== undefined) this.#fallback.delete(oldest);
      }
      this.#fallback.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    cur.count += 1;
    return cur.count <= limit
      ? { allowed: true, retryAfterSec: 0 }
      : { allowed: false, retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)) };
  }

  // ---- hesap + IP kademeli bekleme (042 §11.2) ----
  //
  // İki katman: (1) `(hmac(özne), IP öneki)` çifti başına sayaç (kilitlenme-DoS'u önlemek için bilinçli
  // olarak IP'ye bağlı); (2) özne başına IP'den BAĞIMSIZ küresel sayaç: farklı IPv4/IPv6 önekleri
  // döndürerek dağıtık deneme yapan saldırgan birinci katmanı aşar ama burada toplanır. Küresel
  // katman hesabı KİLİTLEMEZ; eşikten sonra yalnızca hesabın daha önce başarıyla girdiği ağ
  // öneklerinin DIŞINDAN gelen denemeler aynı üstel bekletmeyi alır (saldırgan, kurbanı kendi
  // ağından dışarıda bırakamaz). Özne: parola adımında e-posta, TOTP adımında `uid:<kullanıcı>`.

  /** Başarısız giriş sayacı anahtarı: `(hmac(e-posta), IP /24 öneki)`. */
  accountKey(email: string, ip: string): string {
    return `${RL_PREFIX}auth-account:${this.pseudonym(email)}:${ipPrefix(ip)}`;
  }

  /** Özne başına küresel başarısız deneme sayacı (IP'siz). */
  globalAccountKey(subject: string): string {
    return `${RL_PREFIX}auth-account-global:${this.pseudonym(subject)}`;
  }

  /** Özne için daha önce başarıyla girilmiş ağ önekleri (sıralı küme, en yeni KNOWN_PREFIXES_MAX). */
  knownPrefixKey(subject: string): string {
    return `${RL_PREFIX}auth-known:${this.pseudonym(subject)}`;
  }

  /** Eşikten sonra kalan bekleme (sn); 0 = serbest. Valkey yoksa fail-closed (503). */
  async backoffRemainingSec(email: string, ip: string): Promise<number> {
    let h: Record<string, string>;
    let g: Record<string, string>;
    try {
      [h, g] = await Promise.all([
        this.#redis.hgetall(this.accountKey(email, ip)),
        this.#redis.hgetall(this.globalAccountKey(email)),
      ]);
    } catch {
      throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE');
    }
    const local = this.#remainingSec(
      Number(h.count ?? '0'),
      Number(h.last ?? '0'),
      backoffDelaySec,
    );
    const gCount = Number(g.count ?? '0');
    const global = this.#remainingSec(gCount, Number(g.last ?? '0'), globalBackoffDelaySec);
    if (global === 0 || local >= global) return local;
    try {
      const known = await this.#redis.zscore(this.knownPrefixKey(email), ipPrefix(ip));
      return known === null ? global : local;
    } catch {
      throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE');
    }
  }

  #remainingSec(count: number, last: number, delay: (n: number) => number): number {
    const delaySec = delay(count);
    if (delaySec === 0) return 0;
    const remaining = last + delaySec * 1000 - this.#now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    const key = this.accountKey(email, ip);
    const gKey = this.globalAccountKey(email);
    const now = this.#now();
    // Küresel sayaç en uzun beklemeyi de kapsayacak kadar yaşar (aksi hâlde sayaç bekleme bitmeden
    // sıfırlanır ve saldırgan her turda eşik kadar bedava deneme alırdı).
    const globalTtlMs =
      (CONFIG_DEFAULTS['auth.loginFailureWindowMin'] * 60 +
        CONFIG_DEFAULTS['auth.loginBackoffMaxSec']) *
      1000;
    try {
      const res = await this.#redis
        .multi()
        .hincrby(key, 'count', 1)
        .hset(key, 'last', String(now))
        .pexpire(key, CONFIG_DEFAULTS['auth.loginFailureWindowMin'] * 60_000)
        .hincrby(gKey, 'count', 1)
        .hset(gKey, 'last', String(now))
        .pexpire(gKey, globalTtlMs)
        .exec();
      const gCount = Number(res?.[3]?.[1] ?? 0);
      if (gCount === CONFIG_DEFAULTS['auth.accountGlobalFailureThreshold']) {
        this.#onGlobalThreshold({ ip });
      }
    } catch {
      // Sayaç yazılamazsa bir sonraki denemede backoffRemainingSec fail-closed davranır.
    }
  }

  /**
   * Başarılı doğrulama: yerel ve küresel sayaç sıfırlanır, `ip` öneki özne için "bilinen ağ"
   * olarak kaydedilir. Yalnızca tam doğrulama (kimlik bilgisini bilen) çağırır.
   */
  async resetFailures(email: string, ip: string): Promise<void> {
    const known = this.knownPrefixKey(email);
    try {
      await this.#redis.del(this.accountKey(email, ip), this.globalAccountKey(email));
      await this.#redis
        .multi()
        .zadd(known, this.#now(), ipPrefix(ip))
        .zremrangebyrank(known, 0, -(KNOWN_PREFIXES_MAX + 1))
        .pexpire(known, CONFIG_DEFAULTS['auth.sessionAbsoluteDays'] * DAY_MS)
        .exec();
    } catch {
      // Sıfırlanamazsa sayaç kendi süresiyle düşer; giriş akışı kırılmaz.
    }
  }

  /**
   * Günlük (UTC günü) sabit pencere sayacı: kimlik e-postası tavanları. `cap` aşılırsa
   * `allowed: false` ve gün sonuna kalan süre. Valkey yoksa fail-closed (503).
   */
  async consumeDaily(
    scope: 'auth-email-ip' | 'auth-email-global',
    id: string,
    cap: number,
  ): Promise<RateDecision> {
    const now = this.#now();
    const day = Math.floor(now / DAY_MS);
    const key = `${RL_PREFIX}${scope}:${id}:${day}`;
    const untilEndMs = (day + 1) * DAY_MS - now;
    try {
      const res = await this.#redis
        .multi()
        .incr(key)
        .pexpire(key, untilEndMs + 3_600_000)
        .exec();
      const count = Number(res?.[0]?.[1] ?? 0);
      return count <= cap
        ? { allowed: true, retryAfterSec: 0 }
        : { allowed: false, retryAfterSec: Math.max(1, Math.ceil(untilEndMs / 1000)) };
    } catch {
      throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE');
    }
  }

  /** Adres başı saatlik e-posta sınırı (042 §11.1 `auth-email-out`): false = gönderme. */
  async allowAuthEmail(email: string): Promise<boolean> {
    const limit = CONFIG_DEFAULTS['rateLimit.authEmailPerAddressPerHour'];
    const d = await this.check('auth-email-out', this.pseudonym(email), limit, 3_600_000);
    return d.allowed;
  }
}

/** `min(base × 2^(n − eşik), max)` sn; n eşik altındaysa 0 (042 §11.2). */
export function backoffDelaySec(failures: number): number {
  const threshold = CONFIG_DEFAULTS['auth.loginBackoffThreshold'];
  if (failures < threshold) return 0;
  const base = CONFIG_DEFAULTS['auth.loginBackoffBaseSec'];
  return Math.min(base * 2 ** (failures - threshold), CONFIG_DEFAULTS['auth.loginBackoffMaxSec']);
}

/** Küresel katmanda `auth.accountGlobalFailureThreshold` aşıldıktan sonraki üstel bekleme (sn). */
export function globalBackoffDelaySec(failures: number): number {
  const threshold = CONFIG_DEFAULTS['auth.accountGlobalFailureThreshold'];
  if (failures < threshold) return 0;
  const base = CONFIG_DEFAULTS['auth.loginBackoffBaseSec'];
  return Math.min(base * 2 ** (failures - threshold), CONFIG_DEFAULTS['auth.loginBackoffMaxSec']);
}

/** IPv4 /24 öneki veya IPv6 /64 öneki (hesap+IP sayacı); IPv6 kısaltmaları açılarak karşılaştırılır. */
export function ipPrefix(ip: string): string {
  if (ip.includes(':')) {
    const b = ipBucket(ip);
    // IPv4'e eşlenmiş IPv6 IPv4 olarak döner.
    if (!b.includes(':')) return ipPrefix(b);
    return b.replace('::/64', '');
  }
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.0` : ip;
}

export function rateLimited(scope: RateScope, retryAfterSec: number, limit?: number): AppError {
  const reason = REASON[scope];
  return new AppError('RATE_LIMITED', {
    ...(reason === undefined ? {} : { reason: reason as never }),
    meta: { retryAfterSec, ...(limit === undefined ? {} : { limit }) },
  });
}
