// @tk TK-28
// KK-050-4 / CTL-CSP-01: nonce'lu CSP. Başlık ayrıştırma, yönerge kümesi, her istekte yeni nonce,
// istek ve yanıt başlığındaki nonce eşitliği, development/production farkı. Veriler sentetiktir.
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCsp, generateNonce, NONCE_HEADER } from '../src/lib/csp.ts';
import { proxy } from '../src/proxy.ts';

const req = (path: string) =>
  new NextRequest(`https://admin.eda.localhost:8443${path}`, {
    headers: { host: 'admin.eda.localhost:8443' },
  });

const parse = (csp: string): Map<string, string[]> =>
  new Map(
    csp.split(';').map((d) => {
      const [name = '', ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );

afterEach(() => vi.unstubAllEnvs());

describe('KK-050-4 CSP: politika metni', () => {
  const nonce = 'dGVzdC1ub25jZQ==';

  it('üretimde yönerge kümesi şablonla birebir; unsafe-inline/unsafe-eval ve dış alan adı yok', () => {
    const csp = buildCsp(nonce, 'production');
    const d = parse(csp);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('script-src')).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'"]);
    expect(d.get('style-src')).toEqual(["'self'", `'nonce-${nonce}'`]);
    expect(d.get('img-src')).toEqual(["'self'", 'data:', 'blob:']);
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.get('font-src')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'none'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.has('upgrade-insecure-requests')).toBe(true);
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toMatch(/https?:|\*/);
  });

  it('development: yalnız script-src unsafe-eval kazanır, upgrade-insecure-requests yok', () => {
    const prod = parse(buildCsp(nonce, 'production'));
    const dev = parse(buildCsp(nonce, 'development'));
    expect(dev.get('script-src')).toEqual([...(prod.get('script-src') ?? []), "'unsafe-eval'"]);
    expect(dev.has('upgrade-insecure-requests')).toBe(false);
    expect(dev.get('style-src')).toEqual(prod.get('style-src'));
  });

  it('nonce 16 bayt rastgele, base64 ve her çağrıda farklıdır', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateNonce()));
    expect(seen.size).toBe(50);
    for (const n of seen) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});

describe('KK-050-4 CSP: proxy', () => {
  it('yanıt ve istek başlığındaki nonce aynıdır; istekler arasında değişir', () => {
    const a = proxy(req('/kullanicilar'));
    const b = proxy(req('/kullanicilar'));
    const cspA = a.headers.get('content-security-policy') ?? '';
    const nonceA = a.headers.get(`x-middleware-request-${NONCE_HEADER}`) ?? '';
    const nonceB = b.headers.get(`x-middleware-request-${NONCE_HEADER}`) ?? '';
    expect(nonceA).not.toBe('');
    expect(cspA).toContain(`'nonce-${nonceA}'`);
    expect(a.headers.get('x-middleware-request-content-security-policy')).toBe(cspA);
    expect(nonceA).not.toBe(nonceB);
    expect(b.headers.get('content-security-policy')).not.toBe(cspA);
  });

  it('istemcinin gönderdiği x-nonce ve CSP başlığı ezilir', () => {
    const res = proxy(
      new NextRequest('https://admin.eda.localhost:8443/kullanicilar', {
        headers: {
          host: 'admin.eda.localhost:8443',
          [NONCE_HEADER]: 'saldirgan',
          'content-security-policy': "script-src 'unsafe-inline'",
        },
      }),
    );
    expect(res.headers.get(`x-middleware-request-${NONCE_HEADER}`)).not.toBe('saldirgan');
    expect(res.headers.get('x-middleware-request-content-security-policy')).not.toContain(
      'unsafe-inline',
    );
  });

  it('giriş sayfası da nonce alır; EDA_ENV=development unsafe-eval ekler', () => {
    expect(proxy(req('/giris')).headers.get('content-security-policy')).toContain("'nonce-");
    vi.stubEnv('EDA_ENV', 'development');
    expect(proxy(req('/giris')).headers.get('content-security-policy')).toContain("'unsafe-eval'");
    vi.stubEnv('EDA_ENV', 'production');
    expect(proxy(req('/giris')).headers.get('content-security-policy')).not.toContain(
      'unsafe-eval',
    );
  });
});
