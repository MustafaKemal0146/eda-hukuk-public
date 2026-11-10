// @tk TK-04
// Yönetim kullanım/limit servisi (veritabanı yok): sonuç eşlemesi, aylık toplam, limit kataloğu ve
// büro anahtar kümesi ile migrasyonun aynılığı.
import { readFileSync } from 'node:fs';
import { ORG_LIMIT_KEYS } from '@eda/contracts/api/admin-usage';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { describe, expect, it } from 'vitest';
import { createAdminUsageService, limitKeys } from '../src/admin/usage-service.ts';

type AdminDb = Parameters<typeof createAdminUsageService>[0]['db'];
type AdminTx = Parameters<Parameters<AdminDb['withAdmin']>[0]>[0];

function fakeDb(
  handler: (sql: string, values: readonly unknown[]) => Record<string, unknown>[],
): AdminDb {
  const tx = {
    query: async (sql: string, values: readonly unknown[] = []) => ({ rows: handler(sql, values) }),
  } as unknown as AdminTx;
  return {
    withAdmin: async (fn) => fn(tx),
    withAdminWrite: async (fn) => fn(tx),
    end: async () => undefined,
  };
}

describe('KK-USAGE-S1: kullanım eşlemesi', () => {
  it('günlük satırlar aylık toplama dönüşür; bigint metin değerleri sayıya çevrilir', async () => {
    const svc = createAdminUsageService({
      db: fakeDb((sql) => {
        if (sql.includes('admin_usage_daily'))
          return [
            {
              day: '2026-01-31',
              calls: '2',
              errors: '1',
              input_tokens: '10',
              cached_input_tokens: '4',
              output_tokens: '5',
              reasoning_tokens: '1',
              cost_micro_usd: '300',
              active_orgs: 1,
            },
            {
              day: '2026-02-01',
              calls: '3',
              errors: '0',
              input_tokens: '20',
              cached_input_tokens: '0',
              output_tokens: '7',
              reasoning_tokens: '0',
              cost_micro_usd: '700',
              active_orgs: 2,
            },
          ];
        if (sql.includes('admin_usage_models'))
          return [
            {
              model_alias: 'edai-flash',
              calls: '5',
              errors: '1',
              input_tokens: '30',
              output_tokens: '12',
              cost_micro_usd: '1000',
            },
          ];
        return [
          {
            org_id: '0198a2b4-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
            org_label: 'Büro',
            org_kind: 'firm',
            calls: '5',
            input_tokens: '30',
            output_tokens: '12',
            cost_micro_usd: '1000',
          },
        ];
      }),
    });
    const r = await svc.usage('a', '2026-01-31', '2026-02-01', null);
    expect(r.totals).toEqual({
      calls: 5,
      errors: 1,
      inputTokens: 30,
      cachedInputTokens: 4,
      outputTokens: 12,
      reasoningTokens: 1,
      costMicroUsd: 1000,
    });
    expect(r.monthly.map((m) => [m.month, m.calls, m.costMicroUsd])).toEqual([
      ['2026-01', 2, 300],
      ['2026-02', 3, 700],
    ]);
    expect(r.models[0]).toMatchObject({ modelAlias: 'edai-flash', costMicroUsd: 1000 });
    expect(r.topOrgs).toHaveLength(1);
  });

  it('büro süzgecinde en çok kullanan büro sorgusu çalışmaz', async () => {
    const seen: string[] = [];
    const svc = createAdminUsageService({
      db: fakeDb((sql) => {
        seen.push(sql);
        return [];
      }),
    });
    const r = await svc.usage(
      'a',
      '2026-01-01',
      '2026-01-02',
      '0198a2b4-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
    );
    expect(seen.some((s) => s.includes('admin_usage_top_orgs'))).toBe(false);
    expect(r.topOrgs).toEqual([]);
  });
});

describe('KK-USAGE-S2: limit kataloğu', () => {
  it('büro anahtarları kanonik ayar anahtarıdır, sayısal varsayılanlıdır ve migrasyonla aynıdır', () => {
    for (const k of ORG_LIMIT_KEYS) {
      expect(typeof CONFIG_DEFAULTS[k], k).toBe('number');
    }
    const sql = readFileSync(
      new URL('../../../packages/db/migrations/0039_fn_admin_usage_limits.sql', import.meta.url),
      'utf8',
    );
    const listed = (re: RegExp) =>
      [...(re.exec(sql)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(listed(/"key" IN \(([^)]*)\)/)).toEqual([...ORG_LIMIT_KEYS]);
    expect(listed(/p_key NOT IN \(([^)]*)\)/s).sort()).toEqual([...ORG_LIMIT_KEYS].sort());
  });

  it('katalog sohbet ve maliyet koruması anahtarlarını içerir; sır veya kimlik anahtarı yok', () => {
    const keys = limitKeys();
    expect(keys).toContain('chat.maxStepsPerTurn');
    expect(keys).toContain('costGuard.orgDailyCapFloorMicroUsd');
    expect(keys).toContain('sources.orgLivePerMin');
    expect(keys.some((k) => /secret|password|key$/i.test(k.split('.')[1] ?? ''))).toBe(false);
    expect([...keys].sort()).toEqual(keys);
  });

  it('etkin değer ayar satırı varsa o, yoksa varsayılandır; yanlış türdeki satır yok sayılır', async () => {
    const svc = createAdminUsageService({
      db: fakeDb((sql) => {
        if (sql.includes('admin_limit_platform_values'))
          return [
            { key: 'chat.maxStepsPerTurn', value: 6 },
            { key: 'chat.turnTimeoutSec', value: { x: 1 } },
          ];
        return [
          {
            org_id: '0198a2b4-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
            org_label: 'Büro',
            org_kind: 'firm',
            key: 'sources.orgLivePerMin',
            value: '9',
            updated_at: new Date('2026-02-01T10:00:00Z'),
          },
          {
            org_id: '0198a2b4-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
            org_label: 'Büro',
            org_kind: 'firm',
            key: 'bilinmeyen.anahtar',
            value: '1',
            updated_at: new Date(),
          },
        ];
      }),
    });
    const r = await svc.limits('a', null);
    const steps = r.items.find((i) => i.key === 'chat.maxStepsPerTurn');
    expect(steps).toMatchObject({ defaultValue: 4, effectiveValue: 6, source: 'system_setting' });
    const timeout = r.items.find((i) => i.key === 'chat.turnTimeoutSec');
    expect(timeout).toMatchObject({ effectiveValue: 180, source: 'default' });
    expect(r.overrides).toEqual([
      {
        orgId: '0198a2b4-1c2d-7e3f-8a9b-0c1d2e3f4a5b',
        orgLabel: 'Büro',
        orgKind: 'firm',
        key: 'sources.orgLivePerMin',
        value: 9,
        updatedAt: '2026-02-01T10:00:00.000Z',
      },
    ]);
  });
});
