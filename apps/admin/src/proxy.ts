// Next 16 proxy (yönetim): her sayfa isteğine nonce'lu CSP koyar (061 §2.3). Yetki ve yönlendirme
// kararı VERMEZ; oturumu sunucu düzeni doğrular.
import { type NextRequest, NextResponse } from 'next/server';
import { readEdaEnv } from './config/env.ts';
import { buildCsp, generateNonce, NONCE_HEADER } from './lib/csp.ts';

export function proxy(request: NextRequest): NextResponse {
  // Nonce ve politika istek başlığına da yazılır: Next, kendi betiklerine nonce'u bu başlıktan ekler.
  // İstemci kaynaklı aynı adlı başlıklar ezilir.
  const nonce = generateNonce();
  const csp = buildCsp(nonce, readEdaEnv());
  const headers = new Headers(request.headers);
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
