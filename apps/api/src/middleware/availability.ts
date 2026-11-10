// Drenaj ve bakım (040 §5.5). Drenajda yanıtlara Connection: close eklenir; akış başlatan rotalar
// (P09+) 503 alır. Bakım modunda uygulama yüzeyinde /api/v1/* 503 (istisna listesi hariç).

import { AppError } from '@eda/contracts/errors';
import type { MiddlewareHandler } from 'hono';
import type { SurfaceDeps, SurfaceEnv } from '../context/types.ts';

const MAINTENANCE_EXEMPT = new Set([
  'GET /api/v1/me',
  'GET /api/v1/announcements',
  'GET /api/auth/get-session',
  'POST /api/auth/sign-out',
]);

export function availability(
  deps: Pick<SurfaceDeps, 'surface' | 'state' | 'maintenanceMode'>,
): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    if (
      deps.surface === 'app' &&
      c.req.path.startsWith('/api/v1/') &&
      deps.maintenanceMode() &&
      !MAINTENANCE_EXEMPT.has(`${c.req.method} ${c.req.path}`)
    ) {
      throw new AppError('INTERNAL_MAINTENANCE');
    }
    await next();
    if (deps.state.draining) c.header('Connection', 'close');
  };
}
