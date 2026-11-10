// @tk TK-28
// KK-P04a-15 (KK-045-15): `smtp` taşıması yalnız development/test; production ve beta-synthetic'te
// başlatma hatası; `http` anahtar ve adres ister (adaptör testleri http-transport.test.ts). Başlık enjeksiyonu (CRLF) reddedilir; SMTP
// hataları 045 §6.6 sınıflarına eşlenir. KK-P04a-13: bağlantılar yalnız https APP_URL kökenli, belirteç
// URL parçasında (`#token=`); tarih biçimi Europe/Istanbul.
import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime } from '../src/format.ts';
import { createLinks, LinkError } from '../src/links.ts';
import {
  assertNoCrlf,
  classifySmtpError,
  createEmailTransport,
  EmailTransportConfigError,
  EmailTransportError,
} from '../src/transport/index.ts';

const base = {
  smtpUrl: 'smtp://mailpit:1025',
  from: 'E.D.A. Hukuk <bildirim@ornek.test>',
  timeoutMs: 1000,
};

describe('KK-P04a-15 (KK-045-15): taşıma seçimi', () => {
  it('production, beta-synthetic ve staging ortamında smtp başlatma hatasıdır', () => {
    for (const edaEnv of ['production', 'beta-synthetic', 'staging', 'onprem']) {
      expect(() => createEmailTransport({ ...base, edaEnv, transport: 'smtp' })).toThrow(
        EmailTransportConfigError,
      );
    }
  });

  it('development ve test ortamında smtp kurulur; http adres ve anahtar olmadan kurulmaz', () => {
    for (const edaEnv of ['development', 'test']) {
      const t = createEmailTransport({ ...base, edaEnv, transport: 'smtp' });
      t.close();
    }
    expect(() =>
      createEmailTransport({ ...base, edaEnv: 'production', transport: 'http' }),
    ).toThrow(EmailTransportConfigError);
    const http = createEmailTransport({
      ...base,
      edaEnv: 'production',
      transport: 'http',
      apiUrl: 'https://api.resend.com',
      apiKey: 'sentetik-anahtar',
    });
    http.close();
  });

  it('satır sonu içeren alıcı/konu/başlık reddedilir (payload_invalid)', () => {
    const msg = { to: 'a@ornek.test', subject: 'Konu', html: '<p>x</p>', text: 'x', headers: {} };
    expect(() => assertNoCrlf(msg)).not.toThrow();
    for (const bad of [
      { ...msg, to: 'a@ornek.test\r\nBcc: b@ornek.test' },
      { ...msg, subject: 'Konu\nX: y' },
      { ...msg, headers: { 'X-Entity-Ref-ID': 'id\r\nX: y' } },
    ]) {
      expect(() => assertNoCrlf(bad)).toThrow(EmailTransportError);
    }
  });

  it('SMTP yanıt kodları kalıcı/geçici sınıflara eşlenir', () => {
    expect(classifySmtpError({ responseCode: 550 }).code).toBe('recipient_rejected');
    expect(classifySmtpError({ responseCode: 552 }).code).toBe('message_too_large');
    expect(classifySmtpError({ responseCode: 451 }).code).toBe('provider_rate_limited');
    expect(classifySmtpError({ responseCode: 535 }).code).toBe('provider_auth');
    expect(classifySmtpError({ code: 'ECONNREFUSED' }).code).toBe('provider_unavailable');
    expect(classifySmtpError({ code: 'ETIMEDOUT' }).code).toBe('timeout');
  });
});

describe('KK-P04a-13: bağlantı üreticisi ve biçimler', () => {
  it('yalnız https kökü; belirteç sorguda değil parçada', () => {
    const l = createLinks('https://app.ornek.test:8443');
    expect(l.verifyEmail('a'.repeat(32))).toBe(
      `https://app.ornek.test:8443/eposta-dogrulama#token=${'a'.repeat(32)}`,
    );
    expect(l.resetPassword('b'.repeat(32))).toMatch(
      /^https:\/\/app\.ornek\.test:8443\/sifre-sifirla#token=b+$/,
    );
    expect(l.verifyEmail('c'.repeat(32))).not.toContain('?');
    for (const bad of [
      'http://app.ornek.test',
      'https://app.ornek.test/yol',
      'https://app.ornek.test/?q=1',
      'yok',
    ]) {
      expect(() => createLinks(bad)).toThrow(LinkError);
    }
    expect(() => l.verifyEmail('kısa')).toThrow(LinkError);
    expect(() => l.invitation('not-a-uuid')).toThrow(LinkError);
  });

  it('tarih Europe/Istanbul ve GG.AA.YYYY SS:DD', () => {
    expect(formatDateTime('2026-10-11T21:30:00Z')).toBe('12.10.2026 00:30');
    expect(formatDate('2026-12-31T22:00:00Z')).toBe('01.01.2027');
  });
});
