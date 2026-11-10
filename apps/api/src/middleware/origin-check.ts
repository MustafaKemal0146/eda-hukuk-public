// Origin denetimi / CSRF (040 §5.7): `/api/*` durum değiştiren yöntemlerde `Origin` yüzeyin origin'ine
// (`APP_URL`) birebir eşit olmalı; `Origin` yoksa `Sec-Fetch-Site: same-origin` aranır; ikisi de yoksa
// ret (403 `AUTH_FORBIDDEN`, `reason: origin_mismatch`). İstisna yalnız iyzico webhook'u (P25).
import { AppError } from '@eda/contracts/errors';
import type { EdaLogger } from '@eda/observability/logger';
import type { MiddlewareHandler } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const EXEMPT = new Set(['POST /api/v1/billing/webhooks/iyzico']);

export function originCheck(appUrl: string, logger: EdaLogger): MiddlewareHandler<SurfaceEnv> {
  const expected = new URL(appUrl).origin;
  return async (c, next) => {
    const method = c.req.method;
    if (STATE_CHANGING.has(method) && !EXEMPT.has(`${method} ${c.req.path}`)) {
      const origin = c.req.header('origin');
      const ok =
        origin !== undefined
          ? origin === expected
          : c.req.header('sec-fetch-site') === 'same-origin';
      if (!ok) {
        logger.warn({ event: 'security.origin_rejected', requestId: c.get('requestId') });
        throw new AppError('AUTH_FORBIDDEN', { reason: 'origin_mismatch' });
      }
    }
    await next();
  };
}
