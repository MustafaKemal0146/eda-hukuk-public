// Oturumlu `/api/v1/*` hız sınırı (040 §5.7 sınıf -> kapsam eşlemesi; 002 §7.1): `api` -> `api-user`,
// `chat` -> `chat-user` + `api-user`, `kvkkPreview` -> `kvkk-preview`, `none` -> yok. Valkey yokken
// süreç içi yedek sayaç (fail-open değil, sınırlı).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { MiddlewareHandler } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RateLimiter } from './rate-limit.ts';

const MINUTE = 60_000;

export function userRateLimit(rate: RateLimiter): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    const s = c.get('session');
    if (meta === undefined || s === undefined || meta.rateLimit === 'none') return next();
    const uid = s.userId;
    if (meta.rateLimit === 'kvkkPreview') {
      await rate.enforce(
        'kvkk-preview',
        uid,
        CONFIG_DEFAULTS['rateLimit.kvkkPreviewPerUserPerMin'],
        MINUTE,
      );
      return next();
    }
    if (meta.rateLimit === 'chat') {
      await rate.enforce('chat-user', uid, CONFIG_DEFAULTS['rateLimit.chatPerUserPerMin'], MINUTE);
    }
    await rate.enforce('api-user', uid, CONFIG_DEFAULTS['rateLimit.apiPerUserPerMin'], MINUTE);
    await next();
  };
}
