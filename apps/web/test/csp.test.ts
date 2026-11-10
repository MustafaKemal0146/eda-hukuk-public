// @tk TK-33
// KK-050-4 / CTL-CSP-01: nonce'lu CSP. Başlık ayrıştırma, yönerge kümesi, her istekte yeni nonce,
// istek ve yanıt başlığındaki nonce eşitliği, development/production farkı. Veriler sentetiktir.
import { createHash } from 'node:crypto';
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Switch } from '@base-ui/react/switch';
import { NextRequest } from 'next/server';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCsp,
  generateNonce,
  NONCE_HEADER,
  VISUALLY_HIDDEN_STYLE_HASHES,
} from '../src/lib/csp.ts';
import { proxy } from '../src/proxy.ts';

const COOKIE = '__Host-eda.session_token=x';
const req = (path: string) =>
  new NextRequest(`https://app.eda.localhost:8443${path}`, {
    headers: { host: 'app.eda.localhost:8443', cookie: COOKIE },
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
    expect(d.get('style-src-attr')).toEqual([
      "'unsafe-hashes'",
      ...VISUALLY_HIDDEN_STYLE_HASHES.map((h) => `'sha256-${h}'`),
    ]);
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

describe('KK-050-4 CSP: Base UI gizli girdi stil özeti', () => {
  it('sunucuda yazılan her gizli girdi stili izinli özetlerden biriyle eşleşir (sürüm sapması)', () => {
    const html = renderToStaticMarkup(
      createElement(
        'form',
        null,
        createElement(BaseCheckbox.Root, { name: 'a' }),
        createElement(BaseCheckbox.Root, null),
        createElement(Switch.Root, { name: 'b' }),
        createElement(RadioGroup, { value: 'x' }, createElement(Radio.Root, { value: 'x' })),
      ),
    );
    const styles = [...html.matchAll(/<input[^>]*? style="([^"]*)"/g)].map((m) => m[1] ?? '');
    expect(styles.length).toBeGreaterThanOrEqual(4);
    const allowed = new Set<string>(VISUALLY_HIDDEN_STYLE_HASHES);
    for (const style of styles) {
      const hash = createHash('sha256').update(style).digest('base64');
      expect(allowed.has(hash), style).toBe(true);
    }
  });
});

describe('KK-050-4 CSP: proxy', () => {
  it('yanıt ve istek başlığındaki nonce aynıdır; istekler arasında değişir', () => {
    const a = proxy(req('/sohbet'));
    const b = proxy(req('/sohbet'));
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
      new NextRequest('https://app.eda.localhost:8443/sohbet', {
        headers: {
          host: 'app.eda.localhost:8443',
          cookie: COOKIE,
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

  it('kimlik/tanıtım sayfaları da nonce alır; EDA_ENV=development unsafe-eval ekler', () => {
    const marketing = proxy(
      new NextRequest('https://eda.localhost:8443/', { headers: { host: 'eda.localhost:8443' } }),
    );
    expect(marketing.headers.get('content-security-policy')).toContain("'nonce-");
    vi.stubEnv('EDA_ENV', 'development');
    const dev = proxy(req('/giris'));
    expect(dev.headers.get('content-security-policy')).toContain("'unsafe-eval'");
    vi.stubEnv('EDA_ENV', 'production');
    expect(proxy(req('/giris')).headers.get('content-security-policy')).not.toContain(
      'unsafe-eval',
    );
  });
});
