// @tk TK-28
// Anahtar ataması görünüm modeli (biçim denetimi, hedef yolu, durum tonu, kart durumu, hata
// eşlemesi) ve metin katalogu. Anahtar değeri modelde saklanmaz; yanıt sözleşmeleri anahtarı taşıyamaz.
import {
  AdminAiKeyOrgItemDto,
  AdminAiKeyUserItemDto,
  AdminAiPlatformCapInput,
  AdminAiPlatformKeyDto,
  AdminAiPlatformKeyInput,
} from '@eda/contracts/api/admin-ai-keys';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import {
  capDraftFromCard,
  draftFromCard,
  isKeyInputValid,
  isLabelValid,
  keyErrorKey,
  keyPath,
  microToUsd,
  parsePlatformCap,
  parsePlatformLimits,
  platformState,
  platformTone,
  slotTone,
  targetId,
  targetLabel,
  withKind,
} from '../src/features/ai/ai-keys-model.ts';

const ORG = '0198d2a4-0000-7000-8000-0000000000a1';
const USER = '0198d2a4-0000-7000-8000-0000000000b1';
const org = AdminAiKeyOrgItemDto.parse({
  orgId: ORG,
  shortId: ORG.slice(-8),
  orgLabel: 'Örnek Büro',
  orgKind: 'firm',
  key: { configured: true, last4: 'ab12', updatedAt: '2026-10-16T10:00:00.000Z' },
});
const user = AdminAiKeyUserItemDto.parse({
  userId: USER,
  shortId: USER.slice(-8),
  userEmail: 'ornek@ornek.test',
  verificationStatus: 'verified',
  source: 'own',
  key: { configured: false, last4: null, updatedAt: null },
});
const card = (over: Partial<ReturnType<typeof baseCard>> = {}) => ({ ...baseCard(), ...over });
const baseCard = () => ({
  fallbackEnabled: true,
  fallbackSwitch: true,
  keyConfigured: true,
  active: true,
  key: {
    source: 'panel' as 'panel' | 'server_secret' | null,
    label: 'Ortak Claude anahtarı' as string | null,
    last4: 'ab12' as string | null,
    updatedAt: '2026-10-16T10:00:00.000Z' as string | null,
  },
  last24h: { turns: 3, users: 2, orgs: 1, tokens: 1200, estimatedCostMicroUsd: 18_000 },
  limits: {
    userTurnsPerDay: 50,
    userTokensPerDay: 300_000,
    orgDailyCapMicroUsd: null as number | null,
    estimatedMicroUsdPerMtok: 15_000_000,
    platformDailyCapMicroUsd: 100_000_000,
    custom: {
      userTurnsPerDay: null as number | null,
      userTokensPerDay: null as number | null,
      orgDailyCapMicroUsd: null as number | null,
      platformDailyCapMicroUsd: null as number | null,
    },
    defaults: {
      userTurnsPerDay: 50,
      userTokensPerDay: 300_000,
      orgDailyCapFloorMicroUsd: 2_000_000,
      orgDailyCapPerSeatMicroUsd: 1_000_000,
      platformDailyCapMicroUsd: 100_000_000,
    },
  },
});

describe('AS-0409: anahtar biçimi ve hedef yolu', () => {
  it('geçerli Anthropic biçimi kırpılarak kabul edilir; kısa/yanlış önek/boş reddedilir', () => {
    expect(isKeyInputValid(`  sk-ant-test-${'A'.repeat(30)}  `)).toBe(true);
    expect(isKeyInputValid('sk-ant-kisa')).toBe(false);
    expect(isKeyInputValid(`sk-xyz-${'A'.repeat(40)}`)).toBe(false);
    expect(isKeyInputValid('')).toBe(false);
  });

  it('API yolu hedef türüne göre kurulur; kimlik ve etiket doğru alandan okunur', () => {
    const o = withKind.org(org);
    const u = withKind.user(user);
    expect(keyPath(o)).toBe(`/ai/keys/orgs/${ORG}`);
    expect(keyPath(u)).toBe(`/ai/keys/users/${USER}`);
    expect(targetId(o)).toBe(ORG);
    expect(targetId(u)).toBe(USER);
    expect(targetLabel(o)).toBe('Örnek Büro');
    expect(targetLabel(u)).toBe('ornek@ornek.test');
  });

  it('durum tonu: tanımlı success, yok neutral', () => {
    expect(slotTone(org.key)).toBe('success');
    expect(slotTone(user.key)).toBe('neutral');
  });
});

describe('AS-0409: yanıt sözleşmeleri anahtar taşıyamaz', () => {
  it('liste ve kart şemaları ek (anahtar) alanı reddeder', () => {
    expect(
      AdminAiKeyOrgItemDto.safeParse({ ...org, apiKey: `sk-ant-${'A'.repeat(40)}` }).success,
    ).toBe(false);
    expect(
      AdminAiKeyUserItemDto.safeParse({
        ...user,
        key: { ...user.key, enc: 'x' },
      }).success,
    ).toBe(false);
    expect(AdminAiPlatformKeyDto.safeParse({ ...baseCard(), apiKey: 'x' }).success).toBe(false);
    expect(AdminAiPlatformKeyDto.safeParse(baseCard()).success).toBe(true);
  });

  it('son 4 hane yalnız 4 karakterlik güvenli küme olabilir', () => {
    expect(
      AdminAiKeyOrgItemDto.safeParse({ ...org, key: { ...org.key, last4: 'sk-ant-uzun' } }).success,
    ).toBe(false);
  });
});

describe('AS-0409: platform kartı durumu ve maliyet gösterimi', () => {
  it('ortam kapısı kapalı=off, yumuşak anahtar kapalı=paused, anahtar yok=missing, hazır=on; tonlar', () => {
    expect(platformState(card({ fallbackEnabled: false }))).toBe('off');
    expect(platformState(card({ fallbackSwitch: false }))).toBe('paused');
    expect(platformState(card({ keyConfigured: false }))).toBe('missing');
    expect(platformState(card())).toBe('on');
    expect(platformTone('off')).toBe('neutral');
    expect(platformTone('paused')).toBe('neutral');
    expect(platformTone('missing')).toBe('warning');
    expect(platformTone('on')).toBe('success');
  });

  it('mikro-USD iki ondalıklı USD olur', () => {
    expect(microToUsd(18_000)).toBe(0.02);
    expect(microToUsd(1_000_000)).toBe(1);
    expect(microToUsd(0)).toBe(0);
  });
});

describe('AS-0409: platform anahtarı adı ve limit formu', () => {
  it('ad 3-60 karakter düz metin: kısa/uzun/etiket/denetim karakteri reddedilir', () => {
    expect(isLabelValid('Ortak Claude anahtarı')).toBe(true);
    expect(isLabelValid('  Pilot  ')).toBe(true);
    expect(isLabelValid('ab')).toBe(false);
    expect(isLabelValid('x'.repeat(61))).toBe(false);
    expect(isLabelValid('<b>ad</b>')).toBe(false);
    expect(isLabelValid('satır\nsonu')).toBe(false);
  });

  it('limit taslağı: boş alan null (varsayılana dön), USD mikro-USD olur, sınır dışı alan adıyla reddedilir', () => {
    expect(
      parsePlatformLimits({ userTurnsPerDay: '', userTokensPerDay: '', orgDailyCapUsd: '' }),
    ).toEqual({
      ok: true,
      value: { userTurnsPerDay: null, userTokensPerDay: null, orgDailyCapMicroUsd: null },
    });
    expect(
      parsePlatformLimits({
        userTurnsPerDay: ' 75 ',
        userTokensPerDay: '500000',
        orgDailyCapUsd: '4,5',
      }),
    ).toEqual({
      ok: true,
      value: { userTurnsPerDay: 75, userTokensPerDay: 500_000, orgDailyCapMicroUsd: 4_500_000 },
    });
    const base = { userTurnsPerDay: '', userTokensPerDay: '', orgDailyCapUsd: '' };
    expect(parsePlatformLimits({ ...base, userTurnsPerDay: '0' })).toEqual({
      ok: false,
      field: 'userTurnsPerDay',
    });
    expect(parsePlatformLimits({ ...base, userTurnsPerDay: '10001' }).ok).toBe(false);
    expect(parsePlatformLimits({ ...base, userTurnsPerDay: '1.5' }).ok).toBe(false);
    expect(parsePlatformLimits({ ...base, userTokensPerDay: '999' })).toEqual({
      ok: false,
      field: 'userTokensPerDay',
    });
    expect(parsePlatformLimits({ ...base, orgDailyCapUsd: '0.05' })).toEqual({
      ok: false,
      field: 'orgDailyCapUsd',
    });
    expect(parsePlatformLimits({ ...base, orgDailyCapUsd: 'abc' }).ok).toBe(false);
  });

  it('platform tavanı taslağı: boş null, USD mikro-USD olur, 1-100000 USD dışı ve biçimsiz değer reddedilir', () => {
    expect(parsePlatformCap('')).toEqual({ ok: true, value: { platformDailyCapMicroUsd: null } });
    expect(parsePlatformCap(' 250,5 ')).toEqual({
      ok: true,
      value: { platformDailyCapMicroUsd: 250_500_000 },
    });
    expect(parsePlatformCap('1').ok).toBe(true);
    expect(parsePlatformCap('100000').ok).toBe(true);
    for (const bad of ['0', '0.99', '100000.01', '1000000', 'abc', '-5', '1e3', '12.345']) {
      expect(parsePlatformCap(bad).ok, bad).toBe(false);
    }
    expect(AdminAiPlatformCapInput.safeParse({ platformDailyCapMicroUsd: 999_999 }).success).toBe(
      false,
    );
    expect(AdminAiPlatformCapInput.safeParse({ platformDailyCapMicroUsd: null }).success).toBe(
      true,
    );
    expect(AdminAiPlatformCapInput.safeParse({}).success).toBe(false);
    expect(
      AdminAiPlatformCapInput.safeParse({ platformDailyCapMicroUsd: 5_000_000, extra: 1 }).success,
    ).toBe(false);
  });

  it('kartın panel değerlerinden taslak üretir (mikro-USD USD olarak)', () => {
    const c = card();
    c.limits.custom = {
      userTurnsPerDay: 60,
      userTokensPerDay: null,
      orgDailyCapMicroUsd: 2_500_000,
      platformDailyCapMicroUsd: 250_000_000,
    };
    expect(capDraftFromCard(c)).toBe('250');
    expect(draftFromCard(c)).toEqual({
      userTurnsPerDay: '60',
      userTokensPerDay: '',
      orgDailyCapUsd: '2.5',
    });
  });

  it('kart şeması: yeni yazma girdileri anahtar/ad biçimini dayatır; yanıt anahtar taşıyamaz', () => {
    expect(
      AdminAiPlatformKeyInput.safeParse({ apiKey: `sk-ant-${'A'.repeat(40)}`, label: 'Pilot' })
        .success,
    ).toBe(true);
    expect(AdminAiPlatformKeyInput.safeParse({ apiKey: 'x', label: 'Pilot' }).success).toBe(false);
    expect(AdminAiPlatformKeyInput.safeParse({ apiKey: `sk-ant-${'A'.repeat(40)}` }).success).toBe(
      false,
    );
    expect(
      AdminAiPlatformKeyDto.safeParse({ ...baseCard(), key: { ...baseCard().key, apiKey: 'x' } })
        .success,
    ).toBe(false);
    expect(
      AdminAiPlatformKeyDto.safeParse({
        ...baseCard(),
        key: { ...baseCard().key, last4: 'sk-ant-uzun' },
      }).success,
    ).toBe(false);
  });
});

describe('AS-0409: hata eşlemesi iç ayrıntı sızdırmaz', () => {
  it('kod ve durumdan metin anahtarı seçilir', () => {
    expect(keyErrorKey('VALIDATION_FAILED', 422)).toBe('rejected');
    expect(keyErrorKey('INTERNAL_DEPENDENCY_UNAVAILABLE', 503)).toBe('unreachable');
    expect(keyErrorKey('RATE_LIMITED', 429)).toBe('rateLimited');
    expect(keyErrorKey(undefined, 429)).toBe('rateLimited');
    expect(keyErrorKey('VALIDATION_RESOURCE_NOT_FOUND', 404)).toBe('notFound');
    expect(keyErrorKey('INTERNAL_ERROR', 500)).toBe('generic');
  });
});

describe('AS-0409: metin kataloğu', () => {
  const keys = tr.ai.keys;
  it('her hata anahtarı ve bölüm metni tanımlıdır; metinlerde anahtar örüntüsü yok', () => {
    for (const k of ['rejected', 'unreachable', 'rateLimited', 'notFound', 'generic', 'load']) {
      expect((keys.error as Record<string, string>)[k], k).toBeTruthy();
    }
    const flat = JSON.stringify(keys);
    expect(flat).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/);
    expect(keys.dialog.cancel).toBeTruthy();
    expect(keys.dialog.working).toBeTruthy();
  });

  it('platform kartı üç durum etiketini ve zorunlu sınır açıklamasını içerir', () => {
    for (const k of ['off', 'paused', 'missing', 'on']) {
      expect((keys.platform.state as Record<string, string>)[k], k).toBeTruthy();
    }
    expect(keys.platform.on).toBeTruthy();
    expect(keys.platform.off).toBeTruthy();
    expect(keys.platform.missing).toBeTruthy();
    expect(keys.platform.limits).toContain('{turns}');
    expect(keys.platform.limits).toContain('{tokens}');
  });
});

describe('AS-0409: kullanıcı ayrıntısı "API anahtarı" metinleri', () => {
  it('bölüm metinleri tanımlıdır ve Yapay zekâ sayfasındaki büro listesine yönlendirir', () => {
    const k = tr.users.apiKey;
    for (const key of [
      'title',
      'intro',
      'loading',
      'error',
      'status',
      'source',
      'notFound',
      'orgHint',
      'orgLink',
    ] as const) {
      expect(k[key], key).toBeTruthy();
    }
    expect(JSON.stringify(k)).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/);
  });
});
