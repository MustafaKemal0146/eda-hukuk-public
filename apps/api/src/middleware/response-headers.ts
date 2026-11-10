// Ortak yanıt başlıkları (040 §5.6). CORS yok (aynı origin); sıkıştırma yok.
import type { MiddlewareHandler } from 'hono';

export function responseHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
  };
}
