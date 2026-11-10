// @tk TK-04
// Hesap başına küresel başarısız deneme sayacı (O-4, KK-042-17): IP öneki döndürerek dağıtık deneme
// yapan saldırgan eşikten sonra üstel bekletilir; hesabın daha önce başarıyla girdiği ağ önekleri
// kilitlenmez (kilitlenme-DoS yok); günlük e-posta tavanı UTC gününe göre sayar.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { RateLimiter } from '../src/middleware/rate-limit.ts';

/** Yalnız `RateLimiter`ın kullandığı komutların bellek içi karşılığı. */
function memoryRedis(): Redis {
  const hashes = new Map<string, Record<string, string>>();
  const zsets = new Map<string, Map<string, number>>();
  const counters = new Map<string, number>();
  const ops = {
    hincrby(key: string, field: string, by: number) {
      const h = hashes.get(key) ?? {};
      h[field] = String(Number(h[field] ?? '0') + by);
      hashes.set(key, h);
      return Number(h[field]);
    },
    hset(key: string, field: string, value: string) {
      const h = hashes.get(key) ?? {};
      h[field] = value;
      hashes.set(key, h);
      return 1;
    },
    pexpire: () => 1,
    zadd(key: string, score: number, member: string) {
      const z = zsets.get(key) ?? new Map<string, number>();
      z.set(member, score);
      zsets.set(key, z);
      return 1;
    },
    zremrangebyrank(key: string, start: number, stop: number) {
      const z = zsets.get(key);
      if (z === undefined) return 0;
      const sorted = [...z.entries()].sort((a, b) => a[1] - b[1]);
      const n = sorted.length;
      const from = start < 0 ? Math.max(n + start, 0) : start;
      const to = stop < 0 ? n + stop : stop;
      for (const [m] of sorted.slice(from, to + 1)) z.delete(m);
      return 1;
    },
    incr(key: string) {
      counters.set(key, (counters.get(key) ?? 0) + 1);
      return counters.get(key);
    },
  };
  type Op = keyof typeof ops;
  const chain = () => {
    const queue: (() => unknown)[] = [];
    const c: Record<string, unknown> = {};
    for (const name of Object.keys(ops) as Op[]) {
      c[name] = (...args: unknown[]) => {
        queue.push(() => (ops[name] as (...a: unknown[]) => unknown)(...args));
        return c;
      };
    }
    c.exec = async () => queue.map((q) => [null, q()]);
    return c;
  };
  return {
    defineCommand: () => undefined,
    hgetall: async (k: string) => hashes.get(k) ?? {},
    del: async (...keys: string[]) => {
      for (const k of keys) hashes.delete(k);
      return keys.length;
    },
    zscore: async (k: string, m: string) => {
      const v = zsets.get(k)?.get(m);
      return v === undefined ? null : String(v);
    },
    multi: chain,
  } as unknown as Redis;
}

const T = CONFIG_DEFAULTS['auth.accountGlobalFailureThreshold'];
const BASE = CONFIG_DEFAULTS['auth.loginBackoffBaseSec'];
const ipN = (i: number) => `10.${Math.floor(i / 250) + 1}.${i % 250}.9`;

function limiter(over: Partial<ConstructorParameters<typeof RateLimiter>[0]> = {}) {
  let now = 1_700_000_000_000;
  const rl = new RateLimiter({
    redis: memoryRedis(),
    hmacKey: Buffer.alloc(32, 7),
    now: () => now,
    ...over,
  });
  return { rl, tick: (ms: number) => (now += ms) };
}

describe('KK-042-17 (O-4): hesap başına küresel sayaç', () => {
  it('her deneme ayrı /24: yerel sayaç eşiğe varmaz, küresel sayaç eşikte bekletmeye başlar', async () => {
    const onGlobalThreshold = vi.fn();
    const { rl } = limiter({ onGlobalThreshold });
    for (let i = 0; i < T - 1; i++) {
      await rl.recordFailure('kurban@ornek.test', ipN(i));
      expect(await rl.backoffRemainingSec('kurban@ornek.test', ipN(1000 + i))).toBe(0);
    }
    expect(onGlobalThreshold).not.toHaveBeenCalled();
    await rl.recordFailure('kurban@ornek.test', ipN(T));
    expect(onGlobalThreshold).toHaveBeenCalledTimes(1);
    expect(await rl.backoffRemainingSec('kurban@ornek.test', ipN(5000))).toBe(BASE);
    // Sonraki başarısızlıklar bekleme süresini üstel artırır; eşik bildirimi tekrarlanmaz.
    await rl.recordFailure('kurban@ornek.test', ipN(5001));
    expect(await rl.backoffRemainingSec('kurban@ornek.test', ipN(5002))).toBe(BASE * 2);
    expect(onGlobalThreshold).toHaveBeenCalledTimes(1);
    // Başka hesap etkilenmez.
    expect(await rl.backoffRemainingSec('baska@ornek.test', ipN(5003))).toBe(0);
  });

  it('bekleme süresi dolunca deneme serbest; saldırı sürerse bekleme tavana (loginBackoffMaxSec) çıkar', async () => {
    const { rl, tick } = limiter();
    for (let i = 0; i < T; i++) await rl.recordFailure('a@ornek.test', ipN(i));
    expect(await rl.backoffRemainingSec('a@ornek.test', ipN(9000))).toBe(BASE);
    tick(BASE * 1000 + 1);
    expect(await rl.backoffRemainingSec('a@ornek.test', ipN(9000))).toBe(0);
    for (let i = 0; i < 40; i++) await rl.recordFailure('a@ornek.test', ipN(100 + i));
    expect(await rl.backoffRemainingSec('a@ornek.test', ipN(9001))).toBe(
      CONFIG_DEFAULTS['auth.loginBackoffMaxSec'],
    );
  });

  it('hesabın başarıyla girdiği ağ öneki kilitlenmez; başarı küresel sayacı sıfırlar', async () => {
    const { rl } = limiter();
    await rl.resetFailures('avukat@ornek.test', '203.0.113.5');
    for (let i = 0; i < T + 3; i++) await rl.recordFailure('avukat@ornek.test', ipN(i));
    expect(await rl.backoffRemainingSec('avukat@ornek.test', ipN(7000))).toBeGreaterThan(0);
    // Aynı /24'ten başka adres: bilinen önek, küresel bekleme uygulanmaz (yerel sayaç boş).
    expect(await rl.backoffRemainingSec('avukat@ornek.test', '203.0.113.99')).toBe(0);
    // Doğrulama başarısı küresel sayacı da sıfırlar.
    await rl.resetFailures('avukat@ornek.test', '203.0.113.5');
    expect(await rl.backoffRemainingSec('avukat@ornek.test', ipN(7001))).toBe(0);
  });

  it('IPv6 /64 içinde adres döndürmek yerel sayacı bölmez (kısaltma biçimi fark etmez)', async () => {
    const { rl } = limiter();
    const thr = CONFIG_DEFAULTS['auth.loginBackoffThreshold'];
    for (let i = 0; i < thr; i++) {
      await rl.recordFailure('v6@ornek.test', `2001:db8:1:2::${(i + 1).toString(16)}`);
    }
    expect(await rl.backoffRemainingSec('v6@ornek.test', '2001:db8:1:2:abcd::1')).toBe(BASE);
    expect(await rl.backoffRemainingSec('v6@ornek.test', '2001:db8:1:3::1')).toBe(0);
  });
});

describe('KK-042-17 (O-6): günlük e-posta tavanı', () => {
  it('UTC günü içinde cap kadar izin verir, sonrası reddeder; ertesi gün sıfırlanır', async () => {
    const { rl, tick } = limiter();
    const out: boolean[] = [];
    for (let i = 0; i < 4; i++)
      out.push((await rl.consumeDaily('auth-email-global', 'all', 3)).allowed);
    expect(out).toEqual([true, true, true, false]);
    const denied = await rl.consumeDaily('auth-email-global', 'all', 3);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSec).toBeGreaterThan(0);
    // IP kovaları birbirinden ayrı sayılır.
    expect((await rl.consumeDaily('auth-email-ip', '203.0.113.5', 1)).allowed).toBe(true);
    expect((await rl.consumeDaily('auth-email-ip', '203.0.113.6', 1)).allowed).toBe(true);
    expect((await rl.consumeDaily('auth-email-ip', '203.0.113.5', 1)).allowed).toBe(false);
    tick(86_400_000);
    expect((await rl.consumeDaily('auth-email-global', 'all', 3)).allowed).toBe(true);
  });
});
