// `stepUp` (040 §5.1 adım 15, §5.10; 042 §6; KK-P04b-8): `stepUp: true` rotada oturumun `step_up_at`
// değeri son `auth.stepUpWindowMin` içinde değilse 403 `AUTH_STEP_UP_REQUIRED` (`actions:
// ["step_up"]`). Pencere `POST /api/v1/me/step-up` ile yenilenir; yeni oturum açılışı da yeniler.
import { AppError } from '@eda/contracts/errors';
import type { MiddlewareHandler } from 'hono';
import { stepUpValid } from '../auth/index.ts';
import type { SurfaceEnv } from '../context/types.ts';

export function stepUp(now: () => number = Date.now): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    if (meta === undefined || !meta.stepUp) return next();
    const s = c.get('session');
    if (s === undefined || !stepUpValid(s.stepUpAt, now())) {
      throw new AppError('AUTH_STEP_UP_REQUIRED', { actions: ['step_up'] });
    }
    await next();
  };
}
