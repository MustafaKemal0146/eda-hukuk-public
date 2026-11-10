// @tk TK-18
// 002 §18 valkey-cache anahtar şablonları ve 021 §6.1 `eda:cfg:sources` yükü.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PublishedSourcesConfig, VALKEY_CACHE_KEYS } from '../src/mcp/index.ts';

const SHA = `${'0'.repeat(63)}f`;

describe('002 §18: valkey-cache anahtarları', () => {
  it('şablonlar eda: önekli; kimlik yalnız SHA-256 hex', () => {
    expect(VALKEY_CACHE_KEYS.sourceResult('bedesten', SHA)).toBe(`eda:src:bedesten:${SHA}`);
    expect(VALKEY_CACHE_KEYS.singleFlight(SHA)).toBe(`eda:sf:${SHA}`);
    expect(VALKEY_CACHE_KEYS.breaker('anayasa')).toBe('eda:brk:anayasa');
    expect(VALKEY_CACHE_KEYS.sourceBucket('bedesten')).toBe('eda:tb:source:bedesten');
    expect(VALKEY_CACHE_KEYS.priorityCounters('verify')).toBe('eda:lq:verify');
    expect(VALKEY_CACHE_KEYS.sourcesConfig).toBe('eda:cfg:sources');
  });

  it('SHA-256 olmayan kimlik (ör. sorgu metni) anahtara giremez', () => {
    expect(() => VALKEY_CACHE_KEYS.sourceResult('bedesten', 'kıdem tazminatı')).toThrow();
    expect(() => VALKEY_CACHE_KEYS.singleFlight(SHA.toUpperCase())).toThrow();
  });
});

describe('021 §6.1: eda:cfg:sources yükü', () => {
  const valid = {
    v: 1,
    published_at: '2026-10-11T00:00:00Z',
    sources_enabled: ['bedesten', 'mevzuat'],
    values: { 'sources.bedesten.tokenIntervalMs': 3500, 'breaker.openMs': 30000 },
  };

  it('geçerli yük kabul edilir', () => {
    expect(PublishedSourcesConfig.safeParse(valid).success).toBe(true);
    expect(PublishedSourcesConfig.safeParse({ ...valid, sources_enabled: null }).success).toBe(
      true,
    );
  });

  it('kapsam dışı, bilinmeyen veya sayısal olmayan anahtar ve ek alan reddedilir', () => {
    for (const values of [
      { 'retrieval.rrfK': 60 },
      { 'sources.yok': 1 },
      { 'sources.bedesten.tokenIntervalMs': -1 },
      { 'sources.bedesten.tokenIntervalMs': '3500' },
    ]) {
      expect(PublishedSourcesConfig.safeParse({ ...valid, values }).success).toBe(false);
    }
    expect(PublishedSourcesConfig.safeParse({ ...valid, query: 'x' }).success).toBe(false);
    expect(PublishedSourcesConfig.safeParse({ ...valid, v: 2 }).success).toBe(false);
  });
});

describe('KK-P11-21 / KK-013-6: gen:schemas araç çıktıları iki kez üretimde değişmez', () => {
  it('gen-tools --check iki kez 0 ile çıkar (llm-tools.generated.ts ve tools.lock.json güncel)', () => {
    const cwd = fileURLToPath(new URL('..', import.meta.url));
    for (let round = 0; round < 2; round++) {
      const out = execFileSync(process.execPath, ['scripts/gen-tools.ts', '--check'], {
        cwd,
        encoding: 'utf8',
      });
      expect(out).toContain('gen-tools: güncel');
    }
  });
});
