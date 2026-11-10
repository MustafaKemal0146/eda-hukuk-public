// @tk TK-28
// Yönetim paneli güvenlik özellikleri (web): Sistem sayfası yedek durumu kartı ve Denetim sayfası yönetim
// girişi güvenliği özeti. Sunucu tarafında çizilir (ağsız); içerik, IP ve e-posta görünmez.
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import tr from '../messages/tr.json' with { type: 'json' };
import { LoginFailuresView } from '../src/features/audit/login-failures-card.tsx';
import { LOGIN_FAILURE_REASONS, loginReasonKey } from '../src/features/audit/model.ts';
import { BackupCard } from '../src/features/system/backup-card.tsx';
import { walLagMinutes } from '../src/features/system/model.ts';

const wrap = (el: ReturnType<typeof createElement>): string =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages: tr,
      timeZone: 'Europe/Istanbul',
      onError: (e: unknown) => {
        throw e;
      },
      children: el,
    }),
  );

const backup = (over: Record<string, unknown> = {}) =>
  ({
    available: true,
    unavailableReason: null,
    generatedAt: '2026-10-17T08:00:00.000Z',
    overall: 'ok',
    lastFullAt: '2026-10-16T01:00:00.000Z',
    lastRunOk: true,
    lastRunAt: '2026-10-17T01:00:00.000Z',
    walLastArchivedAt: '2026-10-17T07:55:00.000Z',
    walLagSeconds: 305,
    offsiteWalSyncAt: '2026-10-17T07:50:00.000Z',
    restoreDrillAt: null,
    restoreDrillOk: null,
    ...over,
  }) as never;

describe('KK-YEDEK-WEB-1: yedek durumu kartı', () => {
  it('sağlıklı kayıt: genel durum, son tam yedek, WAL gecikmesi dakika olarak; tatbikat yoksa "Kayıt yok"', () => {
    const html = wrap(createElement(BackupCard, { backup: backup() }));
    expect(html).toContain('Yedekleme sağlıklı');
    expect(html).toContain('Son tam yedek');
    expect(html).toContain('5 dk');
    expect(html).toContain('Son geri yükleme tatbikatı');
    expect(html).toContain('Kayıt yok');
    expect(walLagMinutes(backup())).toBe(5);
  });

  it('hatalı ve başarısız çalışma ayrı etiketle gösterilir; tatbikat sonucu görünür', () => {
    const html = wrap(
      createElement(BackupCard, {
        backup: backup({
          overall: 'error',
          lastRunOk: false,
          restoreDrillAt: '2026-10-01T10:00:00.000Z',
          restoreDrillOk: true,
        }),
      }),
    );
    expect(html).toContain('Yedekleme hatalı');
    expect(html).toContain('Başarısız');
    expect(html).toContain('Başarılı');
  });

  it('veri yokken neden açıklanır; zaman ve sayı alanları çizilmez', () => {
    for (const [reason, text] of [
      ['no_source', 'erişemez'],
      ['unreachable', 'ulaşılamadı'],
      ['invalid', 'beklenen biçimde değil'],
    ] as const) {
      const html = wrap(
        createElement(BackupCard, {
          backup: backup({
            available: false,
            unavailableReason: reason,
            overall: null,
            generatedAt: null,
            lastFullAt: null,
            walLagSeconds: null,
          }),
        }),
      );
      expect(html, reason).toContain('Yedek durumu şu an görüntülenemiyor');
      expect(html, reason).toContain(text);
      expect(html).not.toContain('Son tam yedek');
    }
  });
});

describe('KK-GIRIS-WEB-1: yönetim girişi güvenliği özeti', () => {
  const data = {
    generatedAt: '2026-10-17T08:00:00.000Z',
    failures24h: 7,
    failures7d: 31,
    lockouts24h: 2,
    byReason: [
      { key: 'invalid_credentials', count: 5 },
      { key: 'backoff', count: 2 },
      { key: 'uydurma_kod', count: 1 },
    ],
  };

  it('sayaçlar ve nedenler görünür; bilinmeyen neden "Diğer" olur; IP/e-posta alanı yoktur', () => {
    const html = wrap(createElement(LoginFailuresView, { data }));
    expect(html).toContain('Son 24 saatte başarısız deneme');
    expect(html).toContain('Son 24 saatte kilitlenme');
    expect(html).toContain('Geçersiz kimlik bilgisi');
    expect(html).toContain('Diğer');
    expect(html).not.toMatch(/@|\d+\.\d+\.\d+\.\d+/);
    expect(html).toContain('alt sınırdır');
  });

  it('kilitlenme yoksa uyarı rozeti çizilmez; neden anahtarları katalogla eşleşir', () => {
    const html = wrap(
      createElement(LoginFailuresView, {
        data: { ...data, lockouts24h: 0, byReason: [] },
      }),
    );
    expect(html).not.toContain('Geri çekilme (kilitlenme)');
    for (const k of LOGIN_FAILURE_REASONS) {
      expect(tr.audit.loginFailures.reason).toHaveProperty(k);
      expect(loginReasonKey(k)).toBe(k);
    }
    expect(loginReasonKey('x')).toBe('other');
  });
});
