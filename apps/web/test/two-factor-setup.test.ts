// @tk TK-33
// KK-IKIADIM: `/iki-adimli` kurulum ekranı — üç adım, uygulama adları, kopyalama düğmesi, kod alanı
// öznitelikleri, düzeltici hata iletisi. Veriler sentetiktir (örnek otpauth adresi, uydurma kodlar).
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import { group4, sanitizeCode, secretOf, TotpSetup } from '../src/features/auth/totp-setup.tsx';

const URI = 'otpauth://totp/Ornek:ornek%40ornek.test?secret=JBSWY3DPEHPK3PXP&issuer=Ornek';

const render = (initial: Parameters<typeof TotpSetup>[0]['initial']): string =>
  renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale: 'tr',
      messages,
      timeZone: 'Europe/Istanbul',
      children: createElement(TotpSetup, { onDone: () => undefined, initial }),
    }),
  );

describe('KK-IKIADIM: kurulum 1. adım', () => {
  const html = render({ stage: 'install' });
  it('adım göstergesi erişilebilir liste ve "Adım 1/3" metni', () => {
    expect(html).toContain('Adım 1/3');
    expect(html).toContain('<ol');
    expect(html).toContain('aria-current="step"');
    for (const n of ['Uygulamayı yükleyin', 'Hesabı ekleyin', 'Kodu girin'])
      expect(html).toContain(n);
  });
  it('doğrulama uygulamalarını adıyla sayar, dış bağlantı/görsel yok', () => {
    for (const n of [
      'Google Authenticator',
      'Microsoft Authenticator',
      'Authy',
      '1Password',
      'Bitwarden Authenticator',
    ])
      expect(html).toContain(n);
    expect(html).toContain('Zaten bir doğrulama uygulamanız varsa');
    expect(html).not.toMatch(/<a\s|<img|href=|src=/);
  });
});

describe('KK-IKIADIM: kurulum 2. adım', () => {
  const html = render({ stage: 'scan', uri: URI });
  it("QR yönergesi, elle anahtar (4'lü gruplar), tür ipucu ve kopyala düğmesi", () => {
    expect(html).toContain('Adım 2/3');
    expect(html).toContain('QR kodu tara');
    expect(html).toContain('JBSW Y3DP EHPK 3PXP');
    expect(html).toContain('zaman tabanlı (TOTP)');
    expect(html).toContain('Anahtarı kopyala');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Bu sayfayı doğrulama uygulamasının bulunduğu telefonda');
  });
  it('anahtar yardımcıları', () => {
    expect(secretOf(URI)).toBe('JBSWY3DPEHPK3PXP');
    expect(secretOf('geçersiz')).toBe('');
    expect(group4('ABCDEFGH')).toBe('ABCD EFGH');
  });
});

describe('KK-IKIADIM: kurulum 3. adım', () => {
  const html = render({ stage: 'code', uri: URI });
  it('kod alanı rakam klavyesi ve tek kullanımlık kod özniteliklerini taşır; otomatik gönderim yok', () => {
    expect(html).toContain('Adım 3/3');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('autoComplete="one-time-code"');
    expect(html).toContain('30 saniyede bir');
    expect(html).toContain('saatinin otomatik ayarlı');
    expect(html).toContain('boşluksuz');
    expect(html).toContain('Kodu doğrula');
  });
  it('6 hane dışı karakterler ayıklanır', () => {
    expect(sanitizeCode('12 34-56 78')).toBe('123456');
    expect(sanitizeCode('abc')).toBe('');
  });
  it('düzeltici hata iletisi katalogdadır', () => {
    expect(messages.auth.twoFactor.setup.codeWrong).toBe(
      'Kod yanlış ya da süresi dolmuş; uygulamadaki yeni kodu yazın.',
    );
  });
});

describe('KK-IKIADIM: yedek kodlar', () => {
  it('güçlendirilmiş açıklama, üç adım tamamlanmış, kodlar listelenir', () => {
    const html = render({ stage: 'backup', uri: URI, codes: ['aaaa-1111', 'bbbb-2222'] });
    expect(html).toContain('aaaa-1111');
    expect(html).toContain('Telefonunuzu kaybeder');
    expect(html).toContain('Panoya kopyala');
    expect(html).not.toContain('Adım ');
  });
});
