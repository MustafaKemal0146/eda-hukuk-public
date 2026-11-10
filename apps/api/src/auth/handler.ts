// `/api/auth/*` (040 §5.1 adım 7–8; 042 §2.9, §6.2, §11.1): önce yol izin listesi (listede olmayan yol
// veya yöntem 404, Better Auth'a verilmez), sonra kimlik yollarında `auth-ip` hız sınırı (Valkey yoksa
// fail-closed 503), sonra kimlik bilgisi değiştiren yollarda step-up ve son MFA yöntemi kapısı
// (`hooks/step-up.ts`), sonra Better Auth işleyicisi. Gövde okunmaz (Better Auth kendisi okur).
// `sign-up/email` 200 yanıtı yeni ve mevcut e-posta için birebir aynı gövdeye indirgenir (hesap
// varlığı sızmaz). Davet kabulünde koltuk tetikleyicisinin `EDA01` hatası Better Auth
// biçiminde 409 `SEAT_LIMIT_REACHED` olur (042 §4.3); diğer Better Auth dışı hatalar hata işleyiciye.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError, errorMessageTr } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import { pgCodeOf } from '../errors/error-handler.ts';
import { type RateLimiter, rateLimited } from '../middleware/rate-limit.ts';
import {
  AUTH_EMAIL_TRIGGERING,
  AUTH_IP_LIMITED,
  authSubPath,
  isAllowedAuthRequest,
} from './allowlist.ts';
import { enforceAuthStepUp } from './hooks/step-up.ts';
import type { Identity } from './index.ts';
import { clientIp, ipBucket } from './net.ts';

export const SIGN_UP_RESPONSE_BODY = JSON.stringify({ token: null, user: null });

export function mountAuthHandler(
  app: Hono<SurfaceEnv>,
  identity: Pick<Identity, 'handle' | 'getSession' | 'assertCanRemoveFactor'>,
  rate: RateLimiter,
  emailCaps: { readonly global: number; readonly perIp: number } = {
    global: CONFIG_DEFAULTS['email.globalDailyCap'],
    perIp: CONFIG_DEFAULTS['email.perIpDailyCap'],
  },
): void {
  app.all('/api/auth/*', async (c) => {
    if (!isAllowedAuthRequest(c.req.method, c.req.path)) {
      throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    }
    const sub = authSubPath(c.req.path);
    const ip = clientIp(c.req.raw.headers);
    if (AUTH_IP_LIMITED.has(sub)) {
      // IPv6'da kova /64'tür: adres başına kova saldırgana sınırsız kova verirdi.
      await rate.enforce(
        'auth-ip',
        ipBucket(ip),
        CONFIG_DEFAULTS['rateLimit.authPerIpPerMin'],
        60_000,
      );
    }
    if (AUTH_EMAIL_TRIGGERING.has(sub)) {
      // E-posta tetikleyen istekler (kayıt, yeniden doğrulama, parola sıfırlama): IP başına ve
      // platform genelinde günlük tavan. Aşılırsa e-posta kuyruğa ALINMAZ ve Better Auth'a hiç
      // gidilmez; yanıt hesabın varlığına bağlı değildir (tavan yalnız istek sayısına bakar).
      const perIp = await rate.consumeDaily('auth-email-ip', ipBucket(ip), emailCaps.perIp);
      if (!perIp.allowed) throw rateLimited('auth-email-ip', perIp.retryAfterSec, emailCaps.perIp);
      const global = await rate.consumeDaily('auth-email-global', 'all', emailCaps.global);
      if (!global.allowed) {
        throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE', {
          meta: { retryAfterSec: global.retryAfterSec },
        });
      }
    }
    await enforceAuthStepUp(identity, sub, c.req.raw.headers);
    let res: Response;
    try {
      res = await identity.handle(c.req.raw);
    } catch (err) {
      if (pgCodeOf(err) === 'EDA01') {
        return c.json(
          {
            code: 'SEAT_LIMIT_REACHED',
            message: errorMessageTr('SEAT_LIMIT_REACHED', 'seat_limit'),
            reason: 'seat_limit',
          },
          409,
        );
      }
      // Üyelik koruma tetikleyicileri (bayi/personel üye yapılamaz; KK-P04b-11).
      if (pgCodeOf(err) === '23514' && sub === '/organization/accept-invitation') {
        return c.json(
          { code: 'AUTH_FORBIDDEN', message: errorMessageTr('AUTH_FORBIDDEN', 'policy_denied') },
          403,
        );
      }
      throw err;
    }
    if (sub === '/sign-up/email' && res.status === 200) {
      const headers = new Headers(res.headers);
      headers.set('Content-Type', 'application/json');
      headers.delete('Content-Length');
      return new Response(SIGN_UP_RESPONSE_BODY, { status: 200, headers });
    }
    return res;
  });
}
