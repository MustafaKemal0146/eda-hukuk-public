// @tk TK-33
// #54 BYOK: Ayarlar > Yapay zekâ API anahtarı. Model saf işlevleri ve panel çizimi; veriler sentetiktir
// (gerçek anahtar yok). Anahtar değeri ekranda görünmez, yalnız son 4 karakter.
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  type AiKeysState,
  canUseOrgSource,
  keyFormatIssue,
  maskedLast4,
  missingSource,
  saveProblemOf,
  usesPlatformKey,
} from '../src/features/settings/ai-keys-model.ts';
import { AiKeysPanel, type AiKeysPanelProps } from '../src/features/settings/ai-keys-panel.tsx';

const noop = () => {};
const KEY = `sk-ant-${'x'.repeat(40)}`;
const slot = (last4: string | null) => ({
  configured: last4 !== null,
  last4,
  verifiedAt: last4 === null ? null : '2026-10-14T10:00:00+03:00',
});
const state = (over: Partial<AiKeysState> = {}): AiKeysState => ({
  org: slot('wxyz'),
  own: slot(null),
  source: 'org',
  canManageOrg: true,
  usable: true,
  effectiveSource: 'org',
  platformFallback: false,
  platformLabel: null,
  ...over,
});

const render = (over: Partial<AiKeysPanelProps> = {}): string =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: createElement(AiKeysPanel, {
        state: 'ready',
        keys: state(),
        requestId: null,
        busy: false,
        onRetry: noop,
        onSource: noop,
        onSaveOrg: async () => null,
        onRemoveOrg: noop,
        onSaveOwn: async () => null,
        onRemoveOwn: noop,
        ...over,
      }),
    }),
  );

describe('#54: API anahtarı modeli', () => {
  it('biçim ön denetimi: boş, yanlış önek ve geçerli anahtar', () => {
    expect(keyFormatIssue('   ')).toBe('empty');
    expect(keyFormatIssue('baska-anahtar-1234567890123456')).toBe('format');
    expect(keyFormatIssue('sk-ant-kisa')).toBe('format');
    expect(keyFormatIssue(KEY)).toBeNull();
    expect(keyFormatIssue(`  ${KEY}  `)).toBeNull();
  });

  it('kayıt hatası: step-up yetki hatasından önce ayrılır; 422 nedenleri ayrışır', () => {
    expect(saveProblemOf(403, 'AUTH_STEP_UP_REQUIRED', null)).toBe('step_up');
    expect(saveProblemOf(403, 'ORG_ROLE_INSUFFICIENT', null)).toBe('forbidden');
    expect(saveProblemOf(422, 'VALIDATION_FAILED', 'api_key_rejected')).toBe('rejected');
    expect(saveProblemOf(422, 'VALIDATION_FAILED', null)).toBe('format');
    expect(saveProblemOf(503, 'INTERNAL_DEPENDENCY_UNAVAILABLE', 'timeout')).toBe('unavailable');
    expect(saveProblemOf(500, 'INTERNAL_ERROR', null)).toBe('failed');
  });

  it('son 4 karakter maskeli gösterilir; seçili kaynakta anahtar yoksa eksik kaynak döner', () => {
    expect(maskedLast4('1234')).toBe('••••1234');
    expect(maskedLast4(null)).toBeNull();
    expect(canUseOrgSource(state())).toBe(true);
    expect(canUseOrgSource(state({ org: slot(null) }))).toBe(false);
    expect(missingSource(state())).toBeNull();
    expect(missingSource(state({ org: slot(null), usable: false }))).toBe('org');
    expect(missingSource(state({ source: 'own', usable: false }))).toBe('own');
  });
});

describe('#54: API anahtarı paneli', () => {
  it('büro anahtarı tanımlıyken son 4 karakter görünür; anahtarın kendisi görünmez', () => {
    const html = render();
    const t = messages.settings.apiKeys;
    expect(html).toContain(t.title);
    expect(html).toContain(t.useOrg);
    expect(html).toContain(t.useOwn);
    expect(html).toContain('••••wxyz');
    expect(html).not.toContain('sk-ant');
    expect(html).not.toContain(t.missing.org);
  });

  it('büroda anahtar yoksa "büro/baroya tanımlanmış API key yok" uyarısı ve kapalı düğme', () => {
    const html = render({ keys: state({ org: slot(null), usable: false }) });
    const t = messages.settings.apiKeys;
    expect(html).toContain(t.missing.org);
    expect(html).toContain(t.orgNone);
    expect(html).toContain('tanımlanmış API key yok');
    // "Bürodan çek" düğmesi anahtar yokken devre dışıdır.
    const orgButton = html.slice(html.indexOf(t.useOrg) - 400, html.indexOf(t.useOrg));
    expect(orgButton).toContain('disabled');
  });

  it('kendi anahtarı seçili ve tanımsızsa kendi anahtarı uyarısı çıkar', () => {
    const html = render({ keys: state({ source: 'own', usable: false }) });
    expect(html).toContain(messages.settings.apiKeys.missing.own);
  });

  it('yalnız sahip ve yönetici büro anahtarını değiştirir; diğerleri salt-okur görür', () => {
    const t = messages.settings.apiKeys;
    const manager = render({ keys: state({ canManageOrg: true }) });
    expect(manager).toContain(t.orgKeyLabel);
    expect(manager).toContain(t.removeOrg);
    const lawyer = render({ keys: state({ canManageOrg: false }) });
    expect(lawyer).not.toContain(t.orgKeyLabel);
    expect(lawyer).not.toContain(t.removeOrg);
    expect(lawyer).toContain(t.orgReadOnly);
    // Kendi anahtarı herkese açıktır.
    expect(lawyer).toContain(t.ownKeyLabel);
  });

  it('giriş alanı parola alanıdır (anahtar gizli girilir)', () => {
    expect(render()).toContain('type="password"');
  });

  it('yükleme ve hata durumları ayrı çizilir', () => {
    const t = messages.settings.apiKeys;
    const loading = render({ state: 'loading', keys: null });
    expect(loading).toContain(t.loading);
    expect(loading).toContain('aria-busy="true"');
    const error = render({
      state: 'error',
      keys: null,
      requestId: '01990000-0000-7000-8000-0000000000ff',
    });
    expect(error).toContain(t.error.title);
    expect(error).toContain('01990000-0000-7000-8000-0000000000ff');
  });

  it('her kayıt hatası türü için `tr` metni vardır', () => {
    const p = messages.settings.apiKeys.problems;
    for (const key of [
      'format',
      'rejected',
      'forbidden',
      'step_up',
      'unavailable',
      'failed',
    ] as const) {
      expect(p[key], key).toBeTruthy();
    }
  });
});

describe('AS-0409: platform ortak anahtarı kullanılıyorken Ayarlar', () => {
  const platform = () =>
    state({
      org: slot(null),
      usable: true,
      effectiveSource: 'platform',
      platformFallback: true,
      platformLabel: null,
    });

  it('model: yalnız efektif kaynak platform ise platform anahtarı kullanılıyor sayılır', () => {
    expect(usesPlatformKey(platform())).toBe(true);
    expect(usesPlatformKey(state())).toBe(false);
    expect(usesPlatformKey(state({ org: slot(null), usable: false, effectiveSource: null }))).toBe(
      false,
    );
  });

  it('panel: "Şu an platformun ortak anahtarı kullanılıyor" bilgisi görünür; eksik anahtar uyarısı çıkmaz', () => {
    const html = render({ keys: platform() });
    const t = messages.settings.apiKeys;
    expect(t.platformInUse).toContain('Şu an platformun ortak anahtarı kullanılıyor');
    expect(t.platformInUse).toContain('kendi anahtarınızı girerek değiştirebilirsiniz');
    expect(html).toContain('Şu an platformun ortak anahtarı kullanılıyor');
    expect(html).not.toContain(t.missing.org);
    expect(html).not.toContain('sk-ant');
  });

  it('panel: yönetimde verilen ad görünür ("Şu an <ad> kullanılıyor"); ad düz metindir', () => {
    const html = render({ keys: { ...platform(), platformLabel: 'Ortak Claude anahtarı' } });
    expect(html).toContain('Şu an Ortak Claude anahtarı kullanılıyor');
    expect(html).not.toContain('Şu an platformun ortak anahtarı kullanılıyor');
    expect(html).not.toContain('sk-ant');
    const escaped = render({ keys: { ...platform(), platformLabel: 'a&b "c"' } });
    expect(escaped).toContain('a&amp;b');
    expect(escaped).not.toContain('<b>');
  });

  it('panel: platform düşüşü yokken (kapalı bayrak) bilgi görünmez, eksik uyarısı eskisi gibi çıkar', () => {
    const html = render({
      keys: state({ org: slot(null), usable: false, effectiveSource: null }),
    });
    expect(html).not.toContain('Şu an platformun ortak anahtarı kullanılıyor');
    expect(html).toContain(messages.settings.apiKeys.missing.org);
  });
});
