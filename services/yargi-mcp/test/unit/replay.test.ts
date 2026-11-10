// @tk TK-18
// KK-P11-19: SOURCE_FIXTURE_MODE=replay ağa çıkmaz (başlatma kapısı: packages/contracts/test/env.test.ts).
// Kayıtlı istek fixture'dan döner; kayıtsız istek SOURCE_UNAVAILABLE olur ve fetch hiç çağrılmaz.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReplayTransport } from '../../src/http/fixtures.ts';
import { searchDecisions } from '../../src/tools/search-decisions.ts';
import { CTX, FIXTURES, makeDeps, NULLS } from '../helpers.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KK-P11-19: replay kipinde ağ çıkışı yok', () => {
  it('kayıtlı ve kayıtsız sorgu: fetch çağrılmaz; kayıtsız istek SOURCE_UNAVAILABLE', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const deps = makeDeps({ transport: createReplayTransport(FIXTURES) });
    const base = { source: 'bedesten' as const, page: 1, page_size: 10, ...NULLS };
    const hit = await searchDecisions(
      deps,
      { ...base, query: 'tahliye taahhüdü', court_types: ['yargitay'] },
      CTX,
    );
    expect(hit.results.length).toBeGreaterThan(0);
    await expect(
      searchDecisions(deps, { ...base, query: 'kayıtsız sorgu', court_types: null }, CTX),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
