// @tk TK-18
// Gerçek valkey-cache (eda_mcp ACL) ile dayanıklılık kabul kriterleri: KK-P11-5 / KK-021-13 (kova, 429),
// KK-P11-6 / KK-021-14 (kesici, bayat, WAF), KK-P11-7 / KK-021-15 (tek uçuş: süreç içi ve iki replika;
// Valkey'e sorgu metni yazılmaz), KK-P11-13 / KK-010-6 (valkey-cache yokken canlı çağrı yok),
// KK-P11-14 (öncelik sınıfları), eda:cfg:sources okuyucusu. Zaman Lua'ya parametre olarak verilir
// (sahte saat); portal yanıtları sentetiktir (ağsız).
import { randomUUID } from 'node:crypto';
import type { SourceCode } from '@eda/contracts/enums';
import { createLogger } from '@eda/observability/logger';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  defaultSourcesConfig,
  type SourcesConfig,
  startSourcesConfigReader,
} from '../../src/config/sources.ts';
import type { Transport } from '../../src/http/fetch.ts';
import { ValkeyRateLimiter } from '../../src/resilience/rate-limit.ts';
import { valkeyState } from '../../src/resilience/state.ts';
import type { ValkeyClient } from '../../src/resilience/valkey.ts';
import { SourceError } from '../../src/sources/errors.ts';
import { UpstreamGateway } from '../../src/sources/gateway.ts';
import { createToolDeps, type ToolDeps } from '../../src/tools/context.ts';
import { searchDecisions } from '../../src/tools/search-decisions.ts';
import { CTX, FakeClock, json, NULLS, scripted, T0 } from '../helpers.ts';
import { connect, recording, resetShared } from './target.ts';

const realCfg = (): SourcesConfig => defaultSourcesConfig();
const logger = createLogger({ service: 'test', level: 'fatal' });

let mcp: Redis;
let api: Redis;

beforeAll(async () => {
  mcp = await connect('eda_mcp');
  api = await connect('eda_api');
});
beforeEach(async () => {
  await resetShared(mcp);
});
afterAll(async () => {
  await resetShared(mcp).catch(() => undefined);
  await api?.del('eda:cfg:sources').catch(() => undefined);
  mcp?.disconnect();
  api?.disconnect();
});

function valkeyDeps(opts: {
  transport: Transport;
  client?: ValkeyClient;
  clock?: { now: () => number; sleep: (ms: number) => Promise<void> };
  cfg?: SourcesConfig;
  enabled?: SourceCode[];
}): ToolDeps & { degraded: string[] } {
  const clock = opts.clock ?? new FakeClock();
  const cfg = opts.cfg ?? realCfg();
  const state = valkeyState(opts.client ?? mcp, cfg);
  const degraded: string[] = [];
  const reportDegraded = (op: string): void => {
    degraded.push(op);
  };
  const gateway = new UpstreamGateway({
    transport: opts.transport,
    cfg,
    userAgent: 'EDA-Hukuk-Kaynak-Istemcisi/1.0 (+https://eda.localhost/guvenlik)',
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    limiter: state.limiter,
    breakers: state.breakers,
    reportDegraded,
  });
  const deps = createToolDeps({
    gateway,
    cfg,
    enabled: new Set(opts.enabled ?? ['bedesten', 'mevzuat']),
    now: clock.now,
    sleep: clock.sleep,
    resultCache: state.resultCache,
    locks: state.locks,
    reportDegraded,
  });
  return Object.assign(deps, { degraded });
}

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

/** Her çalıştırmada benzersiz sorgu: paylaşılan önbellekte önceki koşunun kaydına denk gelmez. */
function argsFor(query: string, page = 1) {
  return {
    source: 'bedesten' as const,
    query,
    court_types: ['yargitay' as const],
    ...NULLS,
    page,
    page_size: 10,
  };
}
const RUN = randomUUID().slice(0, 8);
const variant = (i: number) => argsFor(`kira tespiti ${RUN} ${i}`, (i % 50) + 1);

describe('KK-P11-5 / KK-021-13: Bedesten kovası (valkey-cache Lua)', () => {
  it('60 sn içinde en çok 18 istek portala gider (aralık 3500 ms)', async () => {
    const clock = new FakeClock();
    const sentAt: number[] = [];
    const t = scripted(() => {
      sentAt.push(clock.now());
      return okSearch();
    });
    const deps = valkeyDeps({ transport: t.transport, clock });
    let i = 0;
    while (clock.now() - T0 < 70_000) {
      await searchDecisions(deps, variant(i++), CTX).catch(() => undefined);
    }
    for (const start of sentAt) {
      expect(sentAt.filter((x) => x >= start && x < start + 60_000).length).toBeLessThanOrEqual(18);
    }
    expect(sentAt.filter((x) => x < T0 + 60_000)).toHaveLength(18);
  });

  it('429 + Retry-After: 40 → 40,5 sn istek yok, 429 yeniden denenmez', async () => {
    const clock = new FakeClock();
    const t = scripted((_req, n) =>
      n === 0 ? { status: 429, headers: { 'retry-after': '40' }, body: '' } : okSearch(),
    );
    const deps = valkeyDeps({ transport: t.transport, clock, cfg: { ...realCfg(), retries: 1 } });
    await expect(searchDecisions(deps, variant(100), CTX)).rejects.toMatchObject({
      code: 'SOURCE_RATE_LIMITED',
      retryAfterMs: 40_500,
    });
    expect(t.calls).toHaveLength(1);
    clock.t += 40_000;
    await expect(searchDecisions(deps, variant(101), CTX)).rejects.toMatchObject({
      code: 'SOURCE_RATE_LIMITED',
    });
    expect(t.calls).toHaveLength(1);
    clock.t += 600;
    await expect(searchDecisions(deps, variant(102), CTX)).resolves.toMatchObject({
      status: 'ok',
    });
    expect(t.calls).toHaveLength(2);
  });
});

describe('KK-P11-6 / KK-021-14: devre kesici (eda:brk:<kaynak>)', () => {
  const timeout = () => new SourceError('SOURCE_UNAVAILABLE', 'timeout');

  it('5 ardışık zaman aşımından sonra 6. çağrı portala gitmeden breaker_open', async () => {
    const clock = new FakeClock();
    const t = scripted(timeout);
    const cfg = { ...realCfg(), bedestenTokenIntervalMs: 1, retries: 0 };
    const deps = valkeyDeps({ transport: t.transport, clock, cfg });
    for (let i = 0; i < 5; i++) {
      await expect(searchDecisions(deps, variant(200 + i), CTX)).rejects.toMatchObject({
        reason: 'timeout',
      });
      // 11 sn arayla: 30 sn'lik oran penceresinde ≤ 3 istek; ardışık hata kuralı tetikler.
      clock.t += 11_000;
    }
    await expect(searchDecisions(deps, variant(205), CTX)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      reason: 'breaker_open',
    });
    expect(t.calls).toHaveLength(5);
  });

  it('devre açıkken bayat önbellek kaydı status "stale" + stale_as_of ile döner', async () => {
    const clock = new FakeClock();
    const t = scripted((_r, n) => (n === 0 ? okSearch() : timeout()));
    const cfg = { ...realCfg(), bedestenTokenIntervalMs: 1, retries: 0 };
    const deps = valkeyDeps({ transport: t.transport, clock, cfg });
    const args = variant(300);
    await searchDecisions(deps, args, CTX);
    // Valkey TTL gerçek saatle işler: tazelik sahte saatle aşılır (12 sa), kayıt 24 sa durur.
    clock.t += 13 * 3_600_000;
    for (let i = 0; i < 4; i++) await searchDecisions(deps, args, CTX);
    const out = await searchDecisions(deps, args, CTX);
    expect([out.status, out.stale_as_of, out.cached]).toEqual(['stale', '2026-10-10', true]);
    expect(t.calls).toHaveLength(5);
    expect((await deps.gateway.breakerSnapshot('bedesten')).state).toBe('open');
  });

  it('418 WAF yanıtı devreyi 1 saat açar; ikinci replika da açık görür', async () => {
    const clock = new FakeClock();
    const t = scripted(() => ({ status: 418, headers: {}, body: '' }));
    const deps = valkeyDeps({ transport: t.transport, clock });
    await expect(searchDecisions(deps, variant(400), CTX)).rejects.toMatchObject({
      reason: 'waf_blocked',
    });
    const other = valkeyDeps({ transport: t.transport, clock });
    const snap = await other.gateway.breakerSnapshot('bedesten');
    expect([snap.state, snap.openUntil]).toEqual(['open', clock.now() + 3_600_000]);
    await expect(searchDecisions(other, variant(401), CTX)).rejects.toMatchObject({
      reason: 'breaker_open',
    });
    expect(t.calls).toHaveLength(1);
  });
});

describe('KK-P11-7 / KK-021-15: tek uçuş ve Valkey içeriği', () => {
  const realClock = {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  };
  const fastCfg = (): SourcesConfig => ({ ...realCfg(), bedestenTokenIntervalMs: 1 });

  it('aynı sorguyla eşzamanlı 10 çağrı tek portal isteği; Valkey argümanlarında sorgu yok', async () => {
    const t = scripted(okSearch);
    const slow: Transport = async (req) => {
      await new Promise((r) => setTimeout(r, 100));
      return t.transport(req);
    };
    const rec = recording(mcp);
    const deps = valkeyDeps({
      transport: slow,
      client: rec.client,
      clock: realClock,
      cfg: fastCfg(),
    });
    const query = `tahliye taahhüdü ${RUN}`;
    const outs = await Promise.all(
      Array.from({ length: 10 }, () => searchDecisions(deps, argsFor(query), CTX)),
    );
    expect(t.calls).toHaveLength(1);
    expect(outs.every((o) => o.results.length === 1)).toBe(true);
    const sent = rec.sent.join('\n');
    expect(sent).toMatch(/eda:src:bedesten:[0-9a-f]{64}/);
    expect(sent).toMatch(/eda:sf:[0-9a-f]{64}/);
    for (const word of ['tahliye', 'taahh', RUN]) expect(sent).not.toContain(word);
    const key = /eda:src:bedesten:[0-9a-f]{64}/.exec(sent)?.[0] ?? '';
    const stored = (await mcp.get(key)) ?? '';
    expect(stored).toContain('"fresh_until"');
    for (const word of ['tahliye', 'taahh', RUN]) expect(stored).not.toContain(word);
  });

  it('iki replika (ayrı bağlantı ve süreç içi harita) aynı sorguda tek portal isteği', async () => {
    const t = scripted(okSearch);
    const slow: Transport = async (req) => {
      await new Promise((r) => setTimeout(r, 600));
      return t.transport(req);
    };
    const second = await connect('eda_mcp');
    try {
      const a = valkeyDeps({ transport: slow, clock: realClock, cfg: fastCfg() });
      const b = valkeyDeps({ transport: slow, client: second, clock: realClock, cfg: fastCfg() });
      const args = argsFor(`kira tespiti iki replika ${RUN}`);
      const pa = searchDecisions(a, args, CTX);
      await new Promise((r) => setTimeout(r, 50));
      const [outA, outB] = await Promise.all([pa, searchDecisions(b, args, CTX)]);
      expect(t.calls).toHaveLength(1);
      expect([outA.cached, outB.cached]).toEqual([false, true]);
      expect(outB.results).toEqual(outA.results);
    } finally {
      second.disconnect();
    }
  });
});

describe('KK-P11-13 / KK-010-6: valkey-cache erişilemezken canlı çağrı yapılmaz', () => {
  it('bağlantı yok → SOURCE_UNAVAILABLE limiter_unavailable, portala istek yok', async () => {
    const down = new Redis('redis://127.0.0.1:1', {
      enableOfflineQueue: false,
      enableReadyCheck: false,
      maxRetriesPerRequest: 0,
      lazyConnect: true,
    });
    down.on('error', () => undefined);
    try {
      const t = scripted(okSearch);
      const deps = valkeyDeps({ transport: t.transport, client: down });
      await expect(searchDecisions(deps, variant(500), CTX)).rejects.toMatchObject({
        code: 'SOURCE_UNAVAILABLE',
        reason: 'limiter_unavailable',
      });
      expect(t.calls).toHaveLength(0);
    } finally {
      down.disconnect();
    }
  });
});

describe('KK-P11-14 / KK-021-13: öncelik sınıfları (rate-limit.lua)', () => {
  const p = { intervalMs: 3500, maxWaitMs: 4000, sharePct: 70, windowMs: 60_000 };

  it('verify beklemez: token yoksa hemen reddedilir (bekleme süresi 0 ile verilmez)', async () => {
    const lim = new ValkeyRateLimiter(mcp);
    expect(await lim.take('bedesten', 'verify', T0, p)).toEqual({ ok: true, waitMs: 0 });
    expect(await lim.take('bedesten', 'verify', T0 + 1750, p)).toEqual({
      ok: false,
      retryAfterMs: 1750,
      penalized: false,
    });
  });

  it('verify reddedilmişse ingest dolu kovada da token alamaz', async () => {
    const lim = new ValkeyRateLimiter(mcp);
    await lim.take('bedesten', 'verify', T0, p);
    expect(await lim.take('bedesten', 'verify', T0 + 100, p)).toMatchObject({ ok: false });
    const res = await lim.take('anayasa', 'ingest', T0 + 200, { ...p, intervalMs: 2000 });
    expect(res).toMatchObject({ ok: false, penalized: false });
    expect(await lim.take('anayasa', 'verify', T0 + 300, { ...p, intervalMs: 2000 })).toEqual({
      ok: true,
      waitMs: 0,
    });
  });

  it('çekişmede interactive payı ≥ %70; verify yalnız pay dolunca token alır', async () => {
    const lim = new ValkeyRateLimiter(mcp);
    let interactive = 0;
    let verify = 0;
    let contended = false;
    const sharesAtVerifyGrant: number[] = [];
    // 60 sn boyunca her 250 ms'de önce verify, sonra interactive ister (verify'a avantajlı sıra).
    for (let now = T0; now < T0 + p.windowMs; now += 250) {
      const v = await lim.take('bedesten', 'verify', now, p);
      if (v.ok) {
        if (contended) sharesAtVerifyGrant.push(interactive / (interactive + verify));
        verify += 1;
      } else contended = true;
      const i = await lim.take('bedesten', 'interactive', now, p);
      if (i.ok) interactive += 1;
      else contended = true;
    }
    // Çekişmede verify yalnız interactive payı %70'e ulaşmışken token alır; altında interactive
    // gelecek tokenı rezerve eder.
    expect(sharesAtVerifyGrant.length).toBeGreaterThan(0);
    expect(Math.min(...sharesAtVerifyGrant)).toBeGreaterThanOrEqual(0.7);
    expect(interactive).toBeGreaterThan(2 * verify);
  });
});

describe('021 §6.1: eda:cfg:sources okuyucusu (api yazar, yargi-mcp okur)', () => {
  it('yayımlanan değerler uygulanır, kaynak kümesi yalnız daralır; geçersiz kayıt yok sayılır', async () => {
    const cfg = realCfg();
    const enabled = new Set<SourceCode>(['bedesten', 'mevzuat']);
    const reader = startSourcesConfigReader({
      client: mcp,
      cfg,
      enabled,
      envEnabled: ['bedesten', 'mevzuat'],
      logger,
    });
    try {
      await api.set(
        'eda:cfg:sources',
        JSON.stringify({
          v: 1,
          published_at: '2026-10-11T00:00:00Z',
          sources_enabled: ['bedesten', 'anayasa'],
          values: { 'sources.bedesten.tokenIntervalMs': 5000, 'breaker.openMs': 45_000 },
        }),
      );
      await reader.refresh();
      expect(cfg.bedestenTokenIntervalMs).toBe(5000);
      expect(cfg.breaker.openMs).toBe(45_000);
      expect([...enabled]).toEqual(['bedesten']);

      await api.set('eda:cfg:sources', '{"v":1,"values":{"retrieval.rrfK":1}}');
      await reader.refresh();
      expect(cfg.bedestenTokenIntervalMs).toBe(5000);

      await api.del('eda:cfg:sources');
      await reader.refresh();
      expect(cfg).toEqual(realCfg());
      expect([...enabled]).toEqual(['bedesten', 'mevzuat']);
    } finally {
      reader.stop();
    }
  });
});
