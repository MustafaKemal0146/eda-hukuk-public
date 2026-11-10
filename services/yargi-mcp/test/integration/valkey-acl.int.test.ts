// @tk TK-28
// P11.6 a / : valkey-cache ACL. `eda_mcp` yargi-mcp'nin tüm Valkey işlemlerini (kova, kesici,
// önbellek, tek uçuş kilidi, eda:cfg:sources okuma, PING) yapabilir (yeterlilik) ve bunların dışında
// hiçbir komutu / anahtarı kullanamaz (darlık). `eda_api` eda:cfg:sources yazar, eda:lq:* yalnız okur
// (002 §18). Gerçek valkey-cache: `pnpm --filter @eda/yargi-mcp test:int` (test-db.sh).
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultSourcesConfig } from '../../src/config/sources.ts';
import { ValkeyBreakerStore } from '../../src/resilience/breaker.ts';
import { ValkeyResultCache } from '../../src/resilience/cache.ts';
import { ValkeyRateLimiter } from '../../src/resilience/rate-limit.ts';
import { ValkeyFlightLock } from '../../src/resilience/single-flight.ts';
import { connect, resetShared } from './target.ts';

const SHA = 'a'.repeat(64);
const T = Date.parse('2026-10-11T00:00:00Z');
let mcp: Redis;
let api: Redis;

beforeAll(async () => {
  mcp = await connect('eda_mcp');
  api = await connect('eda_api');
  await resetShared(mcp);
});

afterAll(async () => {
  await resetShared(mcp).catch(() => undefined);
  await mcp?.del(`eda:src:bedesten:${SHA}`, `eda:sf:${SHA}`).catch(() => undefined);
  await api?.del('eda:cfg:sources').catch(() => undefined);
  mcp?.disconnect();
  api?.disconnect();
});

describe('AS-0321: eda_mcp komut kümesi yeterli', () => {
  it('kova: take / penalize / done / peek (EVALSHA, NOSCRIPT sonrası EVAL)', async () => {
    const limiter = new ValkeyRateLimiter(mcp);
    const p = { intervalMs: 3500, maxWaitMs: 4000, sharePct: 70, windowMs: 60_000 };
    expect(await limiter.take('bedesten', 'interactive', T, p)).toEqual({ ok: true, waitMs: 0 });
    expect(await limiter.take('bedesten', 'interactive', T, p)).toEqual({ ok: true, waitMs: 3500 });
    await limiter.doneWaiting('interactive');
    await limiter.penalize('bedesten', T + 10_000, T, p.intervalMs);
    const snap = await limiter.snapshot('bedesten', T, p.intervalMs, p.windowMs);
    expect(snap).toMatchObject({ fillPct: 0, pausedUntil: T + 10_000 });
    expect(snap.waiting).toEqual({ interactive: 0, verify: 0, ingest: 0 });
  });

  it('kesici: allow / failure / waf / release / success / peek', async () => {
    const cfg = defaultSourcesConfig();
    const brk = new ValkeyBreakerStore(mcp, () => cfg.breaker);
    expect(await brk.allow('bedesten', T)).toEqual({ ok: true });
    await brk.onFailure('bedesten', T, 'timeout');
    await brk.onSuccess('bedesten', T);
    await brk.release('bedesten', T);
    await brk.onWaf('bedesten', T);
    expect(await brk.snapshot('bedesten', T)).toEqual({
      state: 'open',
      openUntil: T + cfg.breaker.wafOpenMs,
      reason: 'waf_blocked',
    });
  });

  it('önbellek GET / SET PX, tek uçuş SET NX PX + sahibin bıraktığı kilit, cfg GET, PING', async () => {
    const cache = new ValkeyResultCache(mcp);
    await cache.set('bedesten', SHA, { total: 0 }, T, 1000, 2000);
    expect(await cache.get('bedesten', SHA)).toEqual({
      value: { total: 0 },
      storedAt: T,
      freshUntil: T + 1000,
    });
    const locks = new ValkeyFlightLock(mcp);
    const token = await locks.acquire(SHA, 10_000);
    expect(token).not.toBeNull();
    expect(await locks.acquire(SHA, 10_000)).toBeNull();
    await locks.release(SHA, 'baska-belirtec');
    expect(await locks.acquire(SHA, 10_000)).toBeNull();
    await locks.release(SHA, token ?? '');
    expect(await locks.acquire(SHA, 10_000)).not.toBeNull();
    await expect(mcp.get('eda:cfg:sources')).resolves.toBeDefined();
    await expect(mcp.ping()).resolves.toBe('PONG');
  });
});

describe('AS-0321: eda_mcp kapsam dışı komut ve anahtarlarda NOPERM', () => {
  const denied: [string, (string | number)[]][] = [
    ['SET', ['eda:cfg:sources', '{}']],
    ['GET', ['eda:bull:x']],
    ['GET', ['eda:tb:org:x']],
    ['GET', ['eda:tb:user:x']],
    ['GET', ['eda:rl:x']],
    ['GET', ['src:x']],
    ['HGETALL', ['eda:lq:interactive']],
    ['INCR', ['eda:lq:x']],
    ['EXPIRE', [`eda:src:bedesten:${SHA}`, 1]],
    ['KEYS', ['*']],
    ['SCAN', [0]],
    ['FLUSHALL', []],
    ['CONFIG', ['GET', 'maxmemory']],
    ['INFO', []],
    ['CLIENT', ['LIST']],
    ['CLIENT', ['SETNAME', 'x']],
    ['SCRIPT', ['FLUSH']],
    ['FUNCTION', ['LIST']],
    ['PUBLISH', ['eda:chat:stop:x', '1']],
    ['ACL', ['LIST']],
  ];
  for (const [cmd, args] of denied) {
    it(`${cmd} ${args.join(' ')}`, async () => {
      await expect(mcp.call(cmd, ...args)).rejects.toThrow(/NOPERM/);
    });
  }

  it('script kapsam dışı anahtara veya izinsiz komuta erişemez', async () => {
    await expect(mcp.eval("return redis.call('GET', KEYS[1])", 1, 'eda:bull:x')).rejects.toThrow(
      /NOPERM|ACL failure/,
    );
    await expect(mcp.eval("return redis.call('INCR', KEYS[1])", 1, 'eda:lq:x')).rejects.toThrow(
      /NOPERM|ACL failure/,
    );
    await expect(
      mcp.eval("return redis.call('SET', KEYS[1], 'x')", 1, 'eda:cfg:sources'),
    ).rejects.toThrow(/NOPERM|ACL failure/);
  });
});

describe('002 §18: eda_api valkey-cache anahtarları', () => {
  it('eda:cfg:sources yazar; eda:lq:* okur ama yazamaz', async () => {
    await expect(api.set('eda:cfg:sources', '{}')).resolves.toBe('OK');
    await expect(api.hmget('eda:lq:interactive', 'g')).resolves.toBeDefined();
    await expect(api.hset('eda:lq:interactive', 'g', 1)).rejects.toThrow(/NOPERM/);
    await api.del('eda:cfg:sources');
  });
});
