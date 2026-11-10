// @tk TK-28
//  platform ortak anahtarı kapısı birim testleri (ağsız, veritabansız): sınır zinciri, ay/gün
// bekleme süreleri, büro tavanı, atomik rezervasyon parametreleri, kapanış/iade ve maliyet tahmini. Veriler sentetiktir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { describe, expect, it } from 'vitest';
import {
  createPlatformKeyGate,
  estimateCostMicroUsd,
  type PlatformTurnUsage,
  reservedCostMicroUsd,
  secondsToIstanbulMidnight,
  secondsToIstanbulMonthEnd,
} from '../src/services/ai-keys/platform-gate.ts';
import { staticPlatformSettings } from '../src/services/ai-keys/platform-settings.ts';

type Today = Partial<{
  user_turns_day: number;
  user_tokens_day: number;
  user_turns_month: number;
  user_tokens_month: number;
  org_cost_day: number;
  org_seats: number;
  ov_turns_day: number | null;
  ov_turns_month: number | null;
  ov_tokens_day: number | null;
  ov_tokens_month: number | null;
  org_cap_floor: number | null;
  org_cap_per_seat: number | null;
}>;

type Reserved = {
  turnsDay: number | null;
  tokensDay: number | null;
  turnsMonth: number | null;
  tokensMonth: number | null;
  orgCap: number | null;
  platformCap: number | null;
  reserveCost: number;
  maxConcurrent: number | null;
  windowSec: number;
};

/** Sahte DB: today() satırını verir, rezervasyon çağrısının parametrelerini yakalar ve verilen yanıtı döner. */
function fakeDb(
  today: () => Today,
  opts: {
    reserved?: Reserved[];
    settles?: unknown[][];
    denied?: string | null;
    settleFails?: number;
  } = {},
) {
  let fails = opts.settleFails ?? 0;
  return {
    withTenant: async <T>(
      _ctx: unknown,
      fn: (tx: {
        query: (sql: string, p?: unknown[]) => Promise<{ rows: unknown[] }>;
      }) => Promise<T>,
    ) =>
      fn({
        query: async (sql, p) => {
          if (sql.includes('platform_key_usage_today')) return { rows: [today()] };
          if (sql.includes('platform_key_reserve')) {
            const x = p ?? [];
            opts.reserved?.push({
              turnsDay: x[0] as number | null,
              tokensDay: x[1] as number | null,
              turnsMonth: x[2] as number | null,
              tokensMonth: x[3] as number | null,
              orgCap: x[4] as number | null,
              platformCap: x[5] as number | null,
              reserveCost: x[6] as number,
              maxConcurrent: x[7] as number | null,
              windowSec: x[8] as number,
            });
            return opts.denied
              ? { rows: [{ reservation_id: null, denied: opts.denied }] }
              : { rows: [{ reservation_id: 'res-1', denied: null }] };
          }
          if (sql.includes('platform_key_settle')) {
            if (fails > 0) {
              fails -= 1;
              throw new Error('yazılamadı');
            }
            opts.settles?.push(p ?? []);
            return { rows: [{ ok: true }] };
          }
          throw new Error(`beklenmeyen sorgu: ${sql}`);
        },
      }),
  } as never;
}

const ACTOR = { orgId: 'o1', userId: 'u1' };
const START = { modelAlias: 'edai-flash', conversationId: null, requestId: 'r1' } as const;
const AT = () => new Date('2026-10-16T09:00:00Z');
const usage = (over: Partial<PlatformTurnUsage> = {}): PlatformTurnUsage => ({
  inputTokens: 10,
  outputTokens: 5,
  status: 'success',
  ...over,
});
const code = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code: string; reason?: string }) => `${e.code}:${e.reason ?? ''}`,
  );

async function limitsFor(
  t: Today,
  limits?: Parameters<typeof staticPlatformSettings>[0]['limits'],
): Promise<Reserved> {
  const reserved: Reserved[] = [];
  const g = createPlatformKeyGate({
    db: fakeDb(() => t, { reserved }),
    now: AT,
    ...(limits ? { settings: staticPlatformSettings({ apiKey: 'k', limits }) } : {}),
  });
  await g.begin(ACTOR, START);
  const r = reserved[0];
  if (!r) throw new Error('rezervasyon çağrılmadı');
  return r;
}

describe('KK-AS-0409: platform kapısı sınır zinciri (rezervasyon parametreleri)', () => {
  it('sınır yokken platformKey varsayılanları (50 tur, 300000 token) rezervasyona verilir', async () => {
    expect(CONFIG_DEFAULTS['platformKey.userTurnsPerDay']).toBe(50);
    const r = await limitsFor({ org_seats: 1 });
    expect(r.turnsDay).toBe(50);
    expect(r.tokensDay).toBe(CONFIG_DEFAULTS['platformKey.userTokensPerDay']);
    expect(r.maxConcurrent).toBe(CONFIG_DEFAULTS['chat.userConcurrentStreams']);
    expect(r.windowSec).toBe(CONFIG_DEFAULTS['llm.proxyTimeoutSec']);
    expect(r.platformCap).toBe(CONFIG_DEFAULTS['costGuard.platformDailyCapMicroUsd']);
    expect(r.reserveCost).toBe(reservedCostMicroUsd());
    expect(r.reserveCost).toBeGreaterThan(0);
  });

  it('panel değeri varsayılanı ezer; kullanıcı geçersiz kılması panel değerini ezer', async () => {
    expect((await limitsFor({ org_seats: 1 }, { userTurnsPerDay: 3 })).turnsDay).toBe(3);
    expect(
      (await limitsFor({ ov_turns_day: 10, org_seats: 1 }, { userTurnsPerDay: 3 })).turnsDay,
    ).toBe(10);
    expect((await limitsFor({ org_seats: 1 }, { userTokensPerDay: 1000 })).tokensDay).toBe(1000);
    expect(
      (await limitsFor({ ov_tokens_day: 9000, org_seats: 1 }, { userTokensPerDay: 1000 }))
        .tokensDay,
    ).toBe(9000);
    expect((await limitsFor({ org_seats: 1 }, {})).turnsDay).toBe(50);
  });

  it('KK-PLATFORM-TAVAN: panel platform tavanı yapılandırma varsayılanını ezer; panel boşsa varsayılan geçerli', async () => {
    const cap = (await limitsFor({ org_seats: 1 }, { platformDailyCapMicroUsd: 5_000_000 }))
      .platformCap;
    expect(cap).toBe(5_000_000);
    expect((await limitsFor({ org_seats: 1 }, {})).platformCap).toBe(
      CONFIG_DEFAULTS['costGuard.platformDailyCapMicroUsd'],
    );
  });

  it('kullanıcı geçersiz kılması 0 tur sınırı verir (sıfır sınır geçerli bir sınırdır)', async () => {
    expect((await limitsFor({ ov_turns_day: 0, org_seats: 1 })).turnsDay).toBe(0);
  });

  it('aylık geçersiz kılmalar rezervasyona iletilir', async () => {
    const r = await limitsFor({ ov_turns_month: 5, ov_tokens_month: 77, org_seats: 1 });
    expect(r.turnsMonth).toBe(5);
    expect(r.tokensMonth).toBe(77);
  });

  it('büro tavanı: panel düz tavanı formülü ezer; büro geçersiz kılması panel tavanını ezer', async () => {
    expect((await limitsFor({ org_seats: 10 }, { orgDailyCapMicroUsd: 500_000 })).orgCap).toBe(
      500_000,
    );
    expect(
      (
        await limitsFor(
          { org_seats: 1, org_cap_floor: 9_000_000, org_cap_per_seat: 1 },
          { orgDailyCapMicroUsd: 500_000 },
        )
      ).orgCap,
    ).toBe(9_000_000);
  });

  it('büro tavanı formülü: max(taban, koltuk x koltuk başı)', async () => {
    const floor = CONFIG_DEFAULTS['costGuard.orgDailyCapFloorMicroUsd'];
    const perSeat = CONFIG_DEFAULTS['costGuard.orgDailyCapPerSeatMicroUsd'];
    expect((await limitsFor({ org_seats: 1 })).orgCap).toBe(Math.max(floor, perSeat));
    expect((await limitsFor({ org_seats: 10 })).orgCap).toBe(Math.max(floor, perSeat * 10));
    expect((await limitsFor({ org_seats: 1, org_cap_floor: 5, org_cap_per_seat: 1 })).orgCap).toBe(
      5,
    );
  });
});

describe('KK-AS-0409: rezervasyon reddi ve kapanış', () => {
  const deniedCode = (denied: string) =>
    code(
      createPlatformKeyGate({
        db: fakeDb(() => ({ org_seats: 1 }), { denied }),
        now: AT,
      }).begin(ACTOR, START),
    );

  it('ret nedenleri sınıflı, Türkçe hataya çevrilir (fail-closed: tur başlamaz)', async () => {
    expect(await deniedCode('user_day')).toBe('QUOTA_DAILY_COST_CAP:platform_key_user_day');
    expect(await deniedCode('user_month')).toBe('QUOTA_DAILY_COST_CAP:platform_key_user_month');
    expect(await deniedCode('org_day')).toBe('QUOTA_DAILY_COST_CAP:platform_key_org_day');
    expect(await deniedCode('platform_day')).toBe('QUOTA_DAILY_COST_CAP:platform_key_platform_day');
    expect(await deniedCode('concurrent')).toBe('RATE_LIMITED:chat_user');
  });

  it('costGuard.killSwitch açıkken tur başlamaz (rezervasyon çağrılmaz)', async () => {
    const cfg = CONFIG_DEFAULTS as { 'costGuard.killSwitch': boolean };
    const reserved: Reserved[] = [];
    const g = createPlatformKeyGate({
      db: fakeDb(() => ({ org_seats: 1 }), { reserved }),
      now: AT,
    });
    cfg['costGuard.killSwitch'] = true;
    try {
      expect(await code(g.begin(ACTOR, START))).toBe('INTERNAL_MAINTENANCE:maintenance_mode');
    } finally {
      cfg['costGuard.killSwitch'] = false;
    }
    expect(reserved).toHaveLength(0);
  });

  it('veritabanı hatasında tur başlamaz (hata dışarı atılır)', async () => {
    const g = createPlatformKeyGate({
      db: {
        withTenant: async () => {
          throw new Error('bağlantı yok');
        },
      } as never,
      now: AT,
    });
    await expect(g.begin(ACTOR, START)).rejects.toThrow('bağlantı yok');
  });

  it('42501 (doğrulanmamış üye) AUTH_PENDING_VERIFICATION olur', async () => {
    const g = createPlatformKeyGate({
      db: {
        withTenant: async () => {
          throw Object.assign(new Error('x'), { code: '42501' });
        },
      } as never,
      now: AT,
    });
    expect(await code(g.begin(ACTOR, START))).toBe('AUTH_PENDING_VERIFICATION:');
  });

  it('finish gerçek kullanımı yazar; ikinci finish etkisizdir', async () => {
    const settles: unknown[][] = [];
    const g = createPlatformKeyGate({ db: fakeDb(() => ({ org_seats: 1 }), { settles }), now: AT });
    const h = await g.begin(ACTOR, START);
    await h.finish(usage());
    await h.finish(usage());
    expect(settles).toEqual([['res-1', 'success', 10, 5, estimateCostMicroUsd(10, 5)]]);
  });

  it('hiç kullanılmadan hata ile biten tur iade edilir; kullanımı bilinmeyen başarılı tur rezerve maliyetle kapanır', async () => {
    const settles: unknown[][] = [];
    const g = createPlatformKeyGate({ db: fakeDb(() => ({ org_seats: 1 }), { settles }), now: AT });
    await (await g.begin(ACTOR, START)).finish(
      usage({ inputTokens: 0, outputTokens: 0, status: 'error' }),
    );
    await (await g.begin(ACTOR, START)).finish(usage({ inputTokens: 0, outputTokens: 0 }));
    await (await g.begin(ACTOR, START)).finish(usage({ status: 'error' }));
    expect(settles[0]?.[1]).toBe('released');
    expect(settles[1]).toEqual(['res-1', 'success', 0, 0, reservedCostMicroUsd()]);
    expect(settles[2]?.[1]).toBe('error');
  });

  it('kapanış yazımı bir kez yeniden denenir; ikisi de başarısızsa onRecordFailed çağrılır, tur bozulmaz', async () => {
    let failed = 0;
    const settles: unknown[][] = [];
    const mk = (settleFails: number) =>
      createPlatformKeyGate({
        db: fakeDb(() => ({ org_seats: 1 }), { settles, settleFails }),
        now: AT,
        onRecordFailed: () => {
          failed += 1;
        },
      });
    await (await mk(1).begin(ACTOR, START)).finish(usage());
    expect(failed).toBe(0);
    expect(settles).toHaveLength(1);
    await (await mk(2).begin(ACTOR, START)).finish(usage());
    expect(failed).toBe(1);
    expect(settles).toHaveLength(1);
  });
});

describe('AS-0409: bekleme süresi ve maliyet tahmini', () => {
  it('İstanbul gün sonuna kalan süre (UTC+3): 20:59 UTC -> ~60 sn, 21:00 UTC -> 24 saat', () => {
    expect(secondsToIstanbulMidnight(new Date('2026-10-16T20:59:00Z'))).toBe(60);
    expect(secondsToIstanbulMidnight(new Date('2026-10-16T21:00:00Z'))).toBe(86_400);
    expect(secondsToIstanbulMidnight(new Date('2026-10-16T09:00:00Z'))).toBe(12 * 3600);
  });

  it('ay sonuna kalan süre pozitiftir ve ay geçişinde sıfırlanır', () => {
    expect(secondsToIstanbulMonthEnd(new Date('2026-10-31T20:59:00Z'))).toBe(60);
    expect(secondsToIstanbulMonthEnd(new Date('2026-10-16T09:00:00Z'))).toBeGreaterThan(86_400);
  });

  it('tahmini maliyet = token x fiyat / 1e6 (yukarı yuvarlanır) ve girdi+çıktıyı toplar', () => {
    expect(estimateCostMicroUsd(1_000_000, 0)).toBe(
      CONFIG_DEFAULTS['platformKey.estimatedMicroUsdPerMtok'],
    );
    expect(estimateCostMicroUsd(1, 0)).toBe(15);
    expect(estimateCostMicroUsd(0, 0)).toBe(0);
  });
});
