// @tk TK-28
// KK-P27c-ai: Yapay zekâ ekranı görünüm modeli (etkin/pasif ön denetimi, hata tonu), menü ve metinler.
import type { AdminAiCatalogResponseValue } from '@eda/contracts/api/admin-ai';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import { errorTone, toggleBlock, usageOf } from '../src/features/ai/ai-model.ts';
import { isActive, navFor } from '../src/features/shell/nav.ts';

const caps = { tools: true, strictTools: false };
const provider = (id: string, enabled: boolean) => ({
  id,
  kind: 'deepseek',
  region: 'CN',
  enabled,
  priority: 1,
  allowedDataClasses: ['public' as const],
  transferBasis: null,
  trainingUse: false,
  humanReview: false,
  retentionDays: null,
  secretConfigured: true,
});
const model = (id: string, providerId: string, enabled: boolean) => ({
  id,
  alias: 'edai-flash',
  providerId,
  label: 'Etiket',
  thinking: 'off',
  maxOutputTokens: 1000,
  contextBudget: 8000,
  capabilities: caps,
  enabled,
  priority: 1,
  evalGatePassedAt: null,
});
const at = (c: AdminAiCatalogResponseValue, i: number) => {
  const m = c.models[i];
  if (m === undefined) throw new Error('model yok');
  return m;
};
const catalog = (): AdminAiCatalogResponseValue => ({
  providers: [provider('a', true), provider('b', false)],
  models: [
    model('00000000-0000-4000-8000-000000000001', 'a', true),
    model('00000000-0000-4000-8000-000000000002', 'a', true),
    model('00000000-0000-4000-8000-000000000003', 'b', false),
  ],
  notInDb: { providers: [], models: [] },
});

describe('KK-P27c-ai-6: etkin/pasif ön denetimi sunucu kuralıyla aynıdır', () => {
  it('pasif sağlayıcıdaki model etkinleştirilemez', () => {
    const c = catalog();
    expect(toggleBlock(c, at(c, 2))).toBe('provider_disabled');
  });

  it('takma adın tek etkin modeli pasifleştirilemez; ikinci etkin model varsa serbest', () => {
    const c = catalog();
    expect(toggleBlock(c, at(c, 0))).toBeNull();
    c.models[1] = { ...at(c, 1), enabled: false };
    expect(toggleBlock(c, at(c, 0))).toBe('last_enabled');
  });

  it('pasif sağlayıcıdaki etkin model, "diğer etkin" sayılmaz', () => {
    const c = catalog();
    c.models[1] = { ...at(c, 1), providerId: 'b' };
    expect(toggleBlock(c, at(c, 0))).toBe('last_enabled');
  });
});

describe('KK-P27c-ai-7: kullanım özeti', () => {
  it('hata oranı tonu ve model eşleştirme', () => {
    expect(errorTone(0, 0)).toBe('neutral');
    expect(errorTone(100, 0.01)).toBe('success');
    expect(errorTone(100, 0.05)).toBe('warning');
    expect(errorTone(100, 0.2)).toBe('danger');
    const usage = {
      windowDays: 7,
      items: [
        {
          alias: 'edai-flash',
          providerId: 'a',
          calls: 4,
          errors: 1,
          errorRate: 0.25,
          avgLatencyMs: 10,
        },
      ],
    };
    expect(usageOf(usage, 'edai-flash', 'a')?.calls).toBe(4);
    expect(usageOf(usage, 'edai-pro', 'a')).toBeUndefined();
  });
});

describe('KK-P27c-ai-8: menü ve metinler', () => {
  it('"Yapay zekâ" yalnız super_admin menüsünde; /yapay-zeka etkin yol', () => {
    expect(navFor('super_admin').some((n) => n.key === 'ai' && n.href === '/yapay-zeka')).toBe(
      true,
    );
    expect(navFor('support').some((n) => n.key === 'ai')).toBe(false);
    expect(isActive('/yapay-zeka', '/yapay-zeka')).toBe(true);
    expect(tr.nav.ai).toBe('Yapay zekâ');
  });

  it('istem düzenleme ekranı yok: yalnız "Metni göster" ve salt okur notu', () => {
    expect(tr.ai.prompts.view).toBe('Metni göster');
    expect(JSON.stringify(tr.ai)).not.toMatch(/Düzenle|Kaydet/);
  });
});
