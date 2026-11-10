// Next 16 proxy: her sayfa isteğine nonce'lu CSP koyar (061 §2.3); uygulama alan adında kök yol
// /sohbet'e gider; oturum çerezi olmayan istek uygulama sayfalarında girişe yönlendirilir (iyimser;
// çerezin geçerliliğini api denetler, yetki kararı VERMEZ).
import { type NextRequest, NextResponse } from 'next/server';
import { readEdaEnv } from './config/env.ts';
import { buildCsp, generateNonce, NONCE_HEADER } from './lib/csp.ts';
import { PATH_HEADER } from './lib/login-redirect.ts';
import { APP_PATH_ROOTS } from './lib/session-guard.ts';

/** Oturum gerektiren sayfa kökleri ((app) grubu); istemci 401 kapısıyla ortaktır. */
const PROTECTED = APP_PATH_ROOTS;
const SESSION_COOKIE = '__Host-eda.session_token';

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const host = request.headers.get('host') ?? '';
  if (pathname === '/' && host.startsWith('app.')) {
    return NextResponse.redirect(new URL('/sohbet', request.url));
  }
  const guarded = PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (guarded && !request.cookies.has(SESSION_COOKIE)) {
    // Yalnız tek yol parçalı güvenli dönüş adresi taşınır (açık yönlendirme yok).
    const next = /^\/[A-Za-z0-9/_-]*$/.test(pathname) ? pathname : '/sohbet';
    const url = new URL('/giris', request.url);
    url.searchParams.set('sonraki', next);
    return NextResponse.redirect(url);
  }
  // Sunucu düzeni (`(app)/layout.tsx`) oturumu doğrularken dönüş adresini bilsin diye yol, istek
  // başlığıyla aktarılır. İstemciden gelen aynı adlı başlık önce silinir; değer yalnız burada yazılır.
  // Nonce ve politika da istek başlığına yazılır: Next, kendi betiklerine nonce'u bu başlıktan ekler;
  // sunucu bileşenleri `x-nonce`'u `headers()` ile okur. İstemci kaynaklı aynı adlı başlıklar atılır.
  const nonce = generateNonce();
  const csp = buildCsp(nonce, readEdaEnv());
  const headers = new Headers(request.headers);
  headers.delete(PATH_HEADER);
  headers.set(PATH_HEADER, pathname);
  headers.set(NONCE_HEADER, nonce);
  headers.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  return response;
}

// Sayfa istekleri: statik varlıklar, görüntü uç noktası, api ve ön getirme istekleri hariç.
export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
