// @tk TK-28
// "Platform ortak anahtarı" kartı ve Kullanıcılar ayrıntısı "API anahtarı" bölümü sunucu tarafında
// çizilir (ağsız): ad, son 4 hane ve durum görünür; yazma düğmeleri yalnız yazma yetkisinde bulunur;
// hiçbir çıktıda anahtar örüntüsü yoktur.
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import { PlatformKeyCard } from '../src/features/ai/platform-key-card.tsx';
import { UserKeySection } from '../src/features/users/user-key-section.tsx';

const card = (over: Record<string, unknown> = {}) =>
  ({
    fallbackEnabled: true,
    fallbackSwitch: true,
    keyConfigured: true,
    active: true,
    key: {
      source: 'panel',
      label: 'Ortak Claude anahtarı',
      last4: 'ab12',
      updatedAt: '2026-10-16T10:00:00.000Z',
    },
    last24h: { turns: 3, users: 2, orgs: 1, tokens: 1200, estimatedCostMicroUsd: 18_000 },
    limits: {
      userTurnsPerDay: 50,
      userTokensPerDay: 300_000,
      orgDailyCapMicroUsd: null,
      estimatedMicroUsdPerMtok: 15_000_000,
      platformDailyCapMicroUsd: 100_000_000,
      custom: {
        userTurnsPerDay: null,
        userTokensPerDay: null,
        orgDailyCapMicroUsd: null,
        platformDailyCapMicroUsd: null,
      },
      defaults: {
        userTurnsPerDay: 50,
        userTokensPerDay: 300_000,
        orgDailyCapFloorMicroUsd: 2_000_000,
        orgDailyCapPerSeatMicroUsd: 1_000_000,
        platformDailyCapMicroUsd: 100_000_000,
      },
    },
    ...over,
  }) as never;

const wrap = (el: ReturnType<typeof createElement>): string =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages: tr,
      timeZone: 'Europe/Istanbul',
      // Eksik/geçersiz ileti çevirisi sessizce geçmesin.
      onError: (e: unknown) => {
        throw e;
      },
      children: el,
    }),
  );
const run = (async <T>(fn: () => Promise<T>) => fn()) as never;

describe('AS-0409: platform anahtarı kartı çizimi', () => {
  it('ad, son 4 hane, kaynak ve etkin durum görünür; yazma düğmeleri yazma yetkisinde var', () => {
    const html = wrap(
      createElement(PlatformKeyCard, { card: card(), run, canWrite: true, onChanged: () => {} }),
    );
    expect(html).toContain('Platform ortak anahtarı');
    expect(html).toContain('Ortak Claude anahtarı');
    expect(html).toContain('ab12');
    expect(html).toContain('Yönetimden girilen (şifreli)');
    expect(html).toContain('Etkin');
    for (const label of [
      'Anahtarı değiştir',
      'Adı değiştir',
      'Anahtarı sil',
      'Sınırları kaydet',
      'Tavanı kaydet',
    ]) {
      expect(html, label).toContain(label);
    }
    expect(html).toContain('placeholder="50"');
    expect(html).toContain('Platform geneli günlük harcama tavanı');
    expect(html).toContain('Geçerli tavan: 100,00');
    expect(html).toContain('placeholder="100"');
    expect(html).not.toMatch(/sk-ant-[A-Za-z0-9_-]{8,}/);
  });

  it('salt okur görünümde (support) yazma düğmeleri ve anahtar anahtarı yoktur', () => {
    const html = wrap(
      createElement(PlatformKeyCard, { card: card(), run, canWrite: false, onChanged: () => {} }),
    );
    for (const label of [
      'Anahtarı değiştir',
      'Anahtarı sil',
      'Sınırları kaydet',
      'Tavanı kaydet',
      'Ortak anahtara düşüş',
    ]) {
      expect(html, label).not.toContain(label);
    }
    expect(html).toContain('Ortak Claude anahtarı');
  });

  it('ortam kapısı kapalıyken açıklama görünür; anahtar yokken "Anahtarı gir" sunulur; sunucu sırrı yedek olarak adlanır', () => {
    const closed = wrap(
      createElement(PlatformKeyCard, {
        card: card({ fallbackEnabled: false, active: false }),
        run,
        canWrite: true,
        onChanged: () => {},
      }),
    );
    expect(closed).toContain('Ortam kapısı kapalı');
    expect(closed).toContain('PLATFORM_AI_KEY_FALLBACK');
    const file = wrap(
      createElement(PlatformKeyCard, {
        card: card({ key: { source: 'server_secret', label: null, last4: null, updatedAt: null } }),
        run,
        canWrite: true,
        onChanged: () => {},
      }),
    );
    expect(file).toContain('Sunucu sır dosyası (yedek)');
    expect(file).toContain('Anahtarı gir');
    expect(file).not.toContain('Anahtarı sil');
  });

  it('kullanıcı ayrıntısı bölümü yüklenirken durum metnini verir ve büro listesine bağlanır', () => {
    const html = wrap(
      createElement(UserKeySection, {
        userId: '0198d2a4-0000-7000-8000-0000000000b1',
        run,
        canWrite: true,
      }),
    );
    expect(html).toContain('API anahtarı');
    expect(html).toContain('/yapay-zeka#ai-anahtar');
  });
});
