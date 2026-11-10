// `session` (040 §5.8; 042 §2.5, §10.1): Better Auth oturumu (`cookieCache` kapalı; Valkey ikincil
// depolama). Oturum yok + çerez yok -> 401 `AUTH_UNAUTHENTICATED`; çerez var ama oturum yok/süresi
// dolmuş -> 401 `AUTH_SESSION_EXPIRED`; mutlak süre (`createdAt + auth.sessionAbsoluteDays`) dolmuşsa
// oturum silinir ve 401 (`absolute_timeout`); yasaklı -> 403 `AUTH_SUSPENDED`; personel -> 403
// `AUTH_FORBIDDEN` (`staff_on_app_surface`). Kaydırmalı yenilemenin çerezi yanıta aktarılır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { EdaLogger } from '@eda/observability/logger';
import type { MiddlewareHandler } from 'hono';
import { hasSessionCookie, type Identity } from '../auth/index.ts';
import type { SurfaceEnv } from '../context/types.ts';

const ABSOLUTE_MS = CONFIG_DEFAULTS['auth.sessionAbsoluteDays'] * 86_400_000;

export function session(
  identity: Pick<Identity, 'getSession' | 'revokeSession'>,
  logger: EdaLogger,
  now: () => number = Date.now,
): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    if (meta === undefined || meta.permission === 'public') return next();
    const reject = (
      code: 'AUTH_UNAUTHENTICATED' | 'AUTH_SESSION_EXPIRED',
      reason?: 'absolute_timeout',
    ) => {
      logger.warn({
        event: 'auth.session.rejected',
        reason: reason ?? code,
        requestId: c.get('requestId'),
      });
      return code === 'AUTH_SESSION_EXPIRED'
        ? new AppError('AUTH_SESSION_EXPIRED', reason === undefined ? {} : { reason })
        : new AppError('AUTH_UNAUTHENTICATED');
    };
    const resolved = await identity.getSession(c.req.raw.headers);
    if (resolved === null) {
      throw reject(
        hasSessionCookie(c.req.header('cookie')) ? 'AUTH_SESSION_EXPIRED' : 'AUTH_UNAUTHENTICATED',
      );
    }
    const { session: s, user: u } = resolved;
    if (s.surface !== 'app') throw reject('AUTH_SESSION_EXPIRED');
    if (s.createdAt.getTime() + ABSOLUTE_MS <= now()) {
      await identity.revokeSession(s.token);
      throw reject('AUTH_SESSION_EXPIRED', 'absolute_timeout');
    }
    if (u.platformRole !== 'user') {
      throw new AppError('AUTH_FORBIDDEN', { reason: 'staff_on_app_surface' });
    }
    if (u.banned) throw new AppError('AUTH_SUSPENDED', { reason: 'user_suspended' });
    c.set('session', {
      id: s.id,
      userId: s.userId,
      createdAt: s.createdAt,
      mfaLevel: s.mfaLevel,
      stepUpAt: s.stepUpAt,
      activeOrganizationId: s.activeOrganizationId,
    });
    c.set('user', {
      id: u.id,
      platformRole: u.platformRole,
      verificationStatus: u.verificationStatus,
    });
    await next();
    for (const cookie of resolved.setCookie) c.res.headers.append('Set-Cookie', cookie);
  };
}
