// @tk TK-28
// KK-021-13 (token kovası, 429), KK-021-14 (devre kesici, bayat sonuç, WAF), KK-021-15 (tek uçuş, sorgu
// metni önbellekte yok), KK-P11-13 (valkey-cache yokken canlı çağrı yok). Ağ geçidi ve araç akışı
// bellek ikizleriyle (test/memory-state.ts); Lua uygulaması test/integration'da gerçek valkey-cache'e
// karşı aynı senaryolarla doğrulanır. Sahte saat; portal yanıtları sentetiktir (ağsız).
import { describe, expect, it } from 'vitest';
import { defaultSourcesConfig } from '../../src/config/sources.ts';
import { SourceError } from '../../src/sources/errors.ts';
import { searchDecisions } from '../../src/tools/search-decisions.ts';
import { sourceStatus } from '../../src/tools/source-status.ts';
import { CTX, FakeClock, json, makeDeps, NULLS, scripted, T0 } from '../helpers.ts';

const realCfg = defaultSourcesConfig();
const okSearch = () =>
  json({
    data: {
      emsalKararList: [
        {
          documentId: '979779300',
          itemType: { name: 'YARGITAYKARARI' },
          birimAdi: '3. Hukuk Dairesi',
          esasNo: '2022/8302',
          kararNo: '2023/167',
          kararTarihiStr: '21.02.2023',
        },
      ],
      total: 1,
      start: 0,
    },
    metadata: { FMTY: 'SUCCESS', FMC: 'ADALET_SUCCESS' },
  });
const ARGS = {
  source: 'bedesten' as const,
  query: 'tahliye taahhüdü',
  court_types: ['yargitay' as const],
  ...NULLS,
  page: 1,
  page_size: 10,
};
const variant = (i: number) => ({ ...ARGS, page: (i % 50) + 1 });

describe('KK-021-13: Bedesten token kovası', () => {
  it('60 sn içinde en çok 18 istek portala gider (aralık 3500 ms)', async () => {
    const clock = new FakeClock();
    const sentAt: number[] = [];
    const t = scripted(() => {
      sentAt.push(clock.now());
      return okSearch();
    });
    const deps = makeDeps({ transport: t.transport, clock, cfg: realCfg });
    let i = 0;
    while (clock.now() - T0 < 70_000) {
      await searchDecisions(deps, variant(i++), CTX).catch(() => undefined);
    }
    // Her 60 sn'lik pencerede en çok 18 istek (0, 3,5, …, 59,5 sn).
    for (const start of sentAt) {
      expect(sentAt.filter((x) => x >= start && x < start + 60_000).length).toBeLessThanOrEqual(18);
    }
    expect(sentAt.filter((x) => x < T0 + 60_000)).toHaveLength(18);
  });

  it('interactive ≤ 4 sn rezervasyon yapar; aşan ve verify beklemez → SOURCE_BUSY', async () => {
    const clock = new FakeClock();
    const sentAt: number[] = [];
    const t = scripted(() => {
      sentAt.push(clock.now());
      return okSearch();
    });
    const deps = makeDeps({ transport: t.transport, clock, cfg: realCfg });
    const p = { interactive: CTX, verify: { ...CTX, priority: 'verify' as const } };
    await searchDecisions(deps, variant(0), p.interactive);
    // İkinci istek 3,5 sn sonraki tokenı rezerve eder ve bekler (sahte saat ilerler).
    await searchDecisions(deps, variant(1), p.interactive);
    expect(sentAt.map((x) => x - T0)).toEqual([0, 3500]);
    await expect(searchDecisions(deps, variant(2), p.verify)).rejects.toMatchObject({
      code: 'SOURCE_BUSY',
      reason: 'queue_wait_exceeded',
    });
    expect(t.calls).toHaveLength(2);
  });

  it('429 + Retry-After: 40 → 40,5 sn istek yok, 429 yeniden denenmez', async () => {
    const clock = new FakeClock();
    const t = scripted((_req, n) =>
      n === 0 ? { status: 429, headers: { 'retry-after': '40' }, body: '' } : okSearch(),
    );
    const deps = makeDeps({ transport: t.transport, clock, cfg: { ...realCfg, retries: 1 } });
    await expect(searchDecisions(deps, variant(0), CTX)).rejects.toMatchObject({
      code: 'SOURCE_RATE_LIMITED',
      retryAfterMs: 40_500,
    });
    expect(t.calls).toHaveLength(1);
    clock.t += 40_000;
    await expect(searchDecisions(deps, variant(1), CTX)).rejects.toMatchObject({
      code: 'SOURCE_RATE_LIMITED',
    });
    expect(t.calls).toHaveLength(1);
    clock.t += 600;
    await expect(searchDecisions(deps, variant(2), CTX)).resolves.toMatchObject({ status: 'ok' });
    expect(t.calls).toHaveLength(2);
  });
});

describe('KK-021-14: devre kesici', () => {
  const timeout = () => new SourceError('SOURCE_UNAVAILABLE', 'timeout');

  it('5 ardışık zaman aşımından sonra 6. çağrı portala gitmeden breaker_open', async () => {
    // Çağrılar 11 sn arayla: 30 sn'lik oran penceresi (≥ 4 istek) yerine ardışık hata kuralı tetiklenir.
    const clock = new FakeClock();
    const t = scripted(timeout);
    const deps = makeDeps({
      transport: t.transport,
      clock,
      cfg: { ...realCfg, bedestenTokenIntervalMs: 1, retries: 0 },
    });
    for (let i = 0; i < 5; i++) {
      await expect(searchDecisions(deps, variant(i), CTX)).rejects.toMatchObject({
        reason: 'timeout',
      });
      clock.t += 11_000;
    }
    await expect(searchDecisions(deps, variant(5), CTX)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      reason: 'breaker_open',
    });
    expect(t.calls).toHaveLength(5);
  });

  it('devre açıkken bayat önbellek kaydı status "stale" + stale_as_of ile döner', async () => {
    const clock = new FakeClock();
    const t = scripted((_r, n) => (n === 0 ? okSearch() : timeout()));
    const deps = makeDeps({
      transport: t.transport,
      clock,
      cfg: { ...realCfg, bedestenTokenIntervalMs: 1, retries: 0 },
    });
    await searchDecisions(deps, ARGS, CTX);
    clock.t += 13 * 3_600_000; // taze değil (12 sa), henüz silinmedi (24 sa)
    // Hata oranı kuralı (30 sn'de ≥ 4 istek, %100 hata) 4. hatada devreyi açar.
    for (let i = 0; i < 5; i++) await searchDecisions(deps, ARGS, CTX);
    const out = await searchDecisions(deps, ARGS, CTX);
    expect([out.status, out.stale_as_of, out.cached]).toEqual(['stale', '2026-10-10', true]);
    expect(t.calls).toHaveLength(5);
    expect((await deps.gateway.breakerSnapshot('bedesten')).state).toBe('open');
  });

  it('418 WAF yanıtı devreyi 1 saat açar', async () => {
    const clock = new FakeClock();
    const t = scripted(() => ({ status: 418, headers: {}, body: '' }));
    const deps = makeDeps({ transport: t.transport, clock });
    await expect(searchDecisions(deps, ARGS, CTX)).rejects.toMatchObject({ reason: 'waf_blocked' });
    const snap = await deps.gateway.breakerSnapshot('bedesten');
    expect([snap.state, snap.openUntil]).toEqual(['open', clock.now() + 3_600_000]);
  });
});

describe('KK-021-15: tek uçuş ve önbellek anahtarı', () => {
  it('aynı sorguyla eşzamanlı 10 çağrı tek portal isteği üretir', async () => {
    const t = scripted(okSearch);
    const deps = makeDeps({ transport: t.transport });
    const outs = await Promise.all(
      Array.from({ length: 10 }, () => searchDecisions(deps, ARGS, CTX)),
    );
    expect(t.calls).toHaveLength(1);
    expect(outs.every((o) => o.results.length === 1)).toBe(true);
  });

  it('önbellek anahtarlarında ve değerlerinde sorgu metni geçmez', async () => {
    const deps = makeDeps({ transport: scripted(okSearch).transport });
    await searchDecisions(deps, ARGS, CTX);
    const map = deps.state.resultCache.map;
    const dump = JSON.stringify([...map.entries()]);
    expect(map.size).toBe(1);
    expect([...map.keys()][0]).toMatch(/^bedesten:[0-9a-f]{64}$/);
    expect(dump).not.toContain('tahliye');
  });

  it('kilidi başka replika tutuyorsa önbelleği yoklar ve portala ikinci istek atmaz', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const t = scripted(okSearch);
    const slow = async (req: Parameters<typeof t.transport>[0]) => {
      await gate;
      return t.transport(req);
    };
    const clockA = new FakeClock();
    const a = makeDeps({ transport: slow, clock: clockA });
    // B, A ile aynı valkey-cache'i paylaşan ikinci replika: ilk yoklamada A'nın yanıtı serbest kalır.
    const clockB = new FakeClock();
    clockB.sleep = async (ms: number) => {
      clockB.t += ms;
      release();
      await new Promise((r) => setImmediate(r));
    };
    const b = makeDeps({ transport: slow, clock: clockB, state: a.state });
    const pa = searchDecisions(a, ARGS, CTX);
    await new Promise((r) => setImmediate(r));
    const outB = await searchDecisions(b, ARGS, CTX);
    const outA = await pa;
    expect(t.calls).toHaveLength(1);
    expect([outA.cached, outB.cached]).toEqual([false, true]);
    expect(outB.results).toEqual(outA.results);
    expect(a.state.locks.held.size).toBe(0);
  });
});

describe('KK-P11-13 / KK-010-6: valkey-cache erişilemezken canlı çağrı yapılmaz', () => {
  it('kova ve kesici okunamıyor → SOURCE_UNAVAILABLE limiter_unavailable, portala istek yok', async () => {
    const t = scripted(okSearch);
    const deps = makeDeps({ transport: t.transport });
    deps.state.outage.down = true;
    await expect(searchDecisions(deps, ARGS, CTX)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      reason: 'limiter_unavailable',
    });
    expect(t.calls).toHaveLength(0);
    expect(deps.degraded).toEqual(expect.arrayContaining(['cache_get', 'breaker_allow']));
  });

  it('source_status etkin kaynakları down + limiter_unavailable bildirir', async () => {
    const deps = makeDeps({ transport: scripted(okSearch).transport });
    deps.state.outage.down = true;
    const st = await sourceStatus(deps);
    const bedesten = st.sources.find((s) => s.source === 'bedesten');
    expect(bedesten).toMatchObject({ state: 'down', last_error_reason: 'limiter_unavailable' });
    expect(st.sources.find((s) => s.source === 'anayasa')?.state).toBe('disabled');
  });
});
