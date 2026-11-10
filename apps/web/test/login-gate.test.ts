// @tk TK-33
// Uygulama alanı oturum kapısı: giriş yoksa girişe yönlendirme adresi ve proxy davranışı. Dönüş yolu
// `safeNext` ile doğrulanır (açık yönlendirme yok). Veriler sentetiktir.
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { loginHref, PATH_HEADER } from '../src/lib/login-redirect.ts';
import { proxy } from '../src/proxy.ts';

const req = (path: string, init: { cookie?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`https://app.eda.localhost:8443${path}`, {
    headers: {
      host: 'app.eda.localhost:8443',
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.headers ?? {}),
    },
  });

describe('girişe yönlendirme adresi', () => {
  it('güvenli yolu dönüş adresi olarak taşır', () => {
    expect(loginHref('/sohbet')).toBe('/giris?sonraki=%2Fsohbet');
    expect(loginHref('/belgeler/abc-123')).toBe('/giris?sonraki=%2Fbelgeler%2Fabc-123');
  });

  it("eksik veya tehlikeli yolda /sohbet'e düşer (açık yönlendirme yok)", () => {
    expect(loginHref(null)).toBe('/giris?sonraki=%2Fsohbet');
    expect(loginHref(undefined)).toBe('/giris?sonraki=%2Fsohbet');
    expect(loginHref('//kotu.example')).toBe('/giris?sonraki=%2Fsohbet');
    expect(loginHref('https://kotu.example')).toBe('/giris?sonraki=%2Fsohbet');
    expect(loginHref('/sohbet?x=1')).toBe('/giris?sonraki=%2Fsohbet');
  });
});

describe('proxy: uygulama sayfaları', () => {
  it('çerezsiz istek girişe yönlenir (menüdeki her sayfa)', () => {
    for (const p of [
      '/sohbet',
      '/donusturucu',
      '/karar-arsivi',
      '/mevzuat',
      '/dosyalar',
      '/belgeler',
      '/takvim',
      '/ayarlar',
    ]) {
      const res = proxy(req(p));
      expect(res.status, p).toBe(307);
      expect(res.headers.get('location'), p).toContain(`/giris?sonraki=${encodeURIComponent(p)}`);
    }
  });

  it('çerezli istek geçer ve yol başlığı yalnız proxy tarafından yazılır', () => {
    const res = proxy(
      req('/sohbet/abc', {
        cookie: '__Host-eda.session_token=x',
        headers: { [PATH_HEADER]: '/sahte-yol' },
      }),
    );
    expect(res.status).toBe(200);
    // İstemcinin gönderdiği başlık ezilir: düzen yalnız proxy'nin yazdığı yolu görür.
    expect(res.headers.get(`x-middleware-request-${PATH_HEADER}`)).toBe('/sohbet/abc');
  });

  it('kök alan adı (tanıtım) girişsiz kalır: proxy dışı yol', () => {
    const res = proxy(
      new NextRequest('https://eda.localhost:8443/', { headers: { host: 'eda.localhost:8443' } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });
});
