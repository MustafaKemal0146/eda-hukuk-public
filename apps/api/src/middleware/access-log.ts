// Erişim günlüğü (040 §5.4): istek bitince tek satır; sorgu dizesi, gövde, başlık ve IP yazılmaz.
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import type { SurfaceDeps, SurfaceEnv } from '../context/types.ts';

const SILENT = new Set(['/health', '/ready', '/metrics']);

export function accessLog(
  deps: Pick<SurfaceDeps, 'logger' | 'surface'>,
): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    if (SILENT.has(c.req.path)) return next();
    const started = performance.now();
    await next();
    const status = c.res.status;
    const entry = {
      event: 'http.request.completed',
      surface: deps.surface,
      method: c.req.method,
      route: routePath(c) || 'unmatched',
      status,
      durationMs: Math.round(performance.now() - started),
      requestId: c.get('requestId'),
    };
    if (status >= 500) deps.logger.error(entry);
    else if (status === 401 || status === 403) deps.logger.warn(entry);
    else deps.logger.info(entry);
  };
}
