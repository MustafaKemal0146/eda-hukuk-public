// @tk TK-18
// KK-P11-12 / KK-021-20 (ilk yarı) / KK-010-4: yargi-mcp durunca api /ready 200 kalır (021 §6.1: canlı
// kısım kapanır, yerel arama ve sohbet sürer). Uçtan uca kesinti testi (tests/e2e/resilience) P01c
// test-runner'ıyla gelir; burada yoklama yumuşak ve main.ts bağlantısı doğrulanır.
import { readFileSync } from 'node:fs';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { createAppSurface } from '../src/app.ts';
import { createReadiness, type Probe } from '../src/health/ready.ts';

const silent = { write: () => undefined };

function surface(probes: Probe[]) {
  const state = { draining: false };
  const ready = createReadiness({ probes, cacheMs: 0, version: 'test', state });
  return createAppSurface({
    surface: 'app',
    logger: createLogger({ service: 'eda-api-test', destination: silent }),
    state,
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 1024,
    ready,
  }).app;
}

describe('KK-P11-12 / KK-010-4: yargi-mcp kesintisi api hazırlığını düşürmez', () => {
  it('yargiMcp yoklaması başarısız → /ready 200, yargiMcp "degraded"', async () => {
    const app = surface([
      { name: 'postgres', hard: true, run: async () => true },
      { name: 'valkey', hard: true, run: async () => true },
      { name: 'yargiMcp', hard: false, run: async () => false },
    ]);
    const res = await app.request('/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      status: 'ok',
      checks: { postgres: 'ok', valkey: 'ok', yargiMcp: 'degraded' },
    });
  });

  it('main.ts yargi-mcp ve valkey-cache yoklamalarını yumuşak (hard: false) bağlar', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/probe\('yargiMcp',\s*false,/);
    expect(main).toMatch(/probe\('valkeyCache',\s*false,/);
  });
});
