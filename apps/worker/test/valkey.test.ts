// @tk TK-23
// KK-P03c-17 (KK-043-20): Valkey `maxmemory-policy` `noeviction` değilse jobs başlamaz.
import { describe, expect, it } from 'vitest';
import { assertNoEviction, parseInfo, ValkeyPolicyError } from '../src/valkey.ts';

const info = (policy: string | null): string =>
  [
    '# Memory',
    'used_memory:1048576',
    'maxmemory:1073741824',
    ...(policy === null ? [] : [`maxmemory_policy:${policy}`]),
    'mem_allocator:jemalloc',
    '',
  ].join('\r\n');

const fakeClient = (text: string) => ({
  calls: [] as string[],
  info(section: 'memory'): Promise<string> {
    this.calls.push(section);
    return Promise.resolve(text);
  },
});

describe('KK-P03c-17: noeviction güvencesi', () => {
  it('INFO çıktısı ayrıştırılır', () => {
    const m = parseInfo(info('noeviction'));
    expect(m.get('maxmemory_policy')).toBe('noeviction');
    expect(m.get('maxmemory')).toBe('1073741824');
    expect(m.has('# Memory')).toBe(false);
  });

  it('noeviction kabul edilir; yalnız INFO memory çağrılır', async () => {
    const c = fakeClient(info('noeviction'));
    await expect(assertNoEviction(c)).resolves.toBeUndefined();
    expect(c.calls).toEqual(['memory']);
  });

  it.each(['allkeys-lru', 'volatile-lru', 'allkeys-lfu', 'volatile-ttl'])(
    '%s reddedilir',
    async (policy) => {
      await expect(assertNoEviction(fakeClient(info(policy)))).rejects.toThrow(ValkeyPolicyError);
    },
  );

  it('alan yoksa reddedilir', async () => {
    await expect(assertNoEviction(fakeClient(info(null)))).rejects.toThrow(/noeviction/);
  });
});
