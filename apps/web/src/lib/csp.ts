// Nonce'lu İçerik Güvenlik Politikası (061 §2.3 nihai şablon; 050 §6.2). Politikayı yalnız uygulama
// (proxy.ts) üretir; Caddy CSP koymaz (002 §4). Dış alan adı, `unsafe-inline` ve CDN yoktur.
// `unsafe-eval` yalnız EDA_ENV=development iken (React geliştirme araçları) eklenir.
// Rapor uç noktası (`/api/v1/csp-reports`, 061 §2.4) api'de henüz yok; `report-uri`/`report-to` o
// uç nokta eklenince şablona girer (boşa giden rapor isteği üretmemek için şimdilik yok).
import type { EdaEnv } from '../config/env.ts';

/**
 * Base UI'nin gizli form girdileri (checkbox, radio, switch...) sunucuda sabit bir `style=""` değeri
 * yazar; nonce bir öznitelik değerini kapsamaz. Tüm satır içi stil özniteliklerini açmak yerine
 * yalnız bu iki sabit değerin SHA-256 özeti `style-src-attr` ile izinlenir (`unsafe-hashes`).
 * Özetler Base UI sürümüne bağlıdır; `test/csp.test.ts` gerçek çıktıyla karşılaştırır (sapmada kırılır).
 * Dinamik değerli `style` (genişlik, konum vb.) bu yolla AÇILMAZ; sunucu işaretlemesinde kullanılmaz.
 */
export const VISUALLY_HIDDEN_STYLE_HASHES = [
  '5F9GrKBhqyaNOeYUtJnXqF6zx18El+yIK5QJdjPDOus=',
  'qEKUM5Nf3NMojcHSmLZ+c8ntxh6x/5XWh7iOAHlGAkI=',
] as const;

/** İstek başına rastgele nonce: 16 bayt CSPRNG, base64. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

export function buildCsp(nonce: string, env: EdaEnv): string {
  const dev = env === 'development';
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-attr 'unsafe-hashes' ${VISUALLY_HIDDEN_STYLE_HASHES.map((h) => `'sha256-${h}'`).join(' ')}`,
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'none'",
  ];
  if (!dev) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

/** Nonce'u istek başlığına taşıyan başlık adı (sunucu bileşenleri `headers()` ile okur). */
export const NONCE_HEADER = 'x-nonce';
