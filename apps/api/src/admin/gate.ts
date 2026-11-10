// Yönetim yüzeyi oturum + `platformGate` (040 §5.2; P27a): her `/api/v1/admin/*` isteğinde oturum
// `surface='admin'` ve `mfa_level` güçlü (`passkey` veya `totp`), kullanıcı `support|super_admin` ve yasaklı değil olmalı;
// aksi 401/403. Mutlak süre (`auth.adminSessionAbsoluteHours`) aşılırsa oturum silinir. İzin denetimi
// `can({surface:'admin', platformRole})`. Kaydırmalı yenileme çerezi yanıta aktarılır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import { can, isPermission } from '@eda/contracts/permissions';
import type { EdaLogger } from '@eda/observability/logger';
import type { MiddlewareHandler } from 'hono';
import { ADMIN_SESSION_COOKIE, STAFF_ROLES } from '../auth/admin-auth.ts';
import type { AdminIdentity } from '../auth/admin-identity.ts';
import { readCookie } from '../auth/cookies.ts';
import type { SurfaceEnv } from '../context/types.ts';

const ABSOLUTE_MS = CONFIG_DEFAULTS['auth.adminSessionAbsoluteHours'] * 3_600_000;

export function adminSession(
  identity: Pick<AdminIdentity, 'getSession' | 'revokeSession'>,
  logger: EdaLogger,
  now: () => number = Date.now,
): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    if (meta === undefined) return next();
    const hasCookie = readCookie(c.req.header('cookie'), ADMIN_SESSION_COOKIE) !== null;
    const unauth = (reason?: 'absolute_timeout') => {
      logger.warn({
        event: 'auth.session.rejected',
        reason: reason ?? (hasCookie ? 'AUTH_SESSION_EXPIRED' : 'AUTH_UNAUTHENTICATED'),
        requestId: c.get('requestId'),
      });
      return hasCookie
        ? new AppError('AUTH_SESSION_EXPIRED', reason === undefined ? {} : { reason })
        : new AppError('AUTH_UNAUTHENTICATED');
    };
    const resolved = await identity.getSession(c.req.raw.headers);
    if (resolved === null) throw unauth();
    const { session: s, user: u } = resolved;
    if (s.surface !== 'admin') throw unauth();
    if (s.createdAt.getTime() + ABSOLUTE_MS <= now()) {
      await identity.revokeSession(s.token);
      throw unauth('absolute_timeout');
    }
    // platformGate
    if (!(STAFF_ROLES as readonly string[]).includes(u.platformRole) || u.banned || u.suspended) {
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
    }
    // Güçlü MFA: passkey VEYA TOTP (parola+TOTP girişi). `none` (kayıt oturumu) reddedilir;
    // hata sözleşmesi (`reason: passkey_required`) değişmez.
    if (s.mfaLevel !== 'passkey' && s.mfaLevel !== 'totp')
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'passkey_required' });
    c.set('session', {
      id: s.id,
      userId: s.userId,
      createdAt: s.createdAt,
      mfaLevel: s.mfaLevel,
      stepUpAt: s.stepUpAt,
      activeOrganizationId: null,
    });
    c.set('user', { id: u.id, platformRole: u.platformRole, verificationStatus: 'verified' });
    c.set('adminName', u.name);
    c.set('adminSessionExpiresAt', s.expiresAt);
    await next();
    for (const cookie of resolved.setCookie) c.res.headers.append('Set-Cookie', cookie);
  };
}

/** `can({surface:'admin'})` kararını 403'e çevirir (`self` yalnız oturum ister). */
export function adminAuthorize(): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const meta = c.get('routeMeta');
    if (meta === undefined || meta.permission === 'self') return next();
    const user = c.get('user');
    if (user === undefined || !isPermission(meta.permission)) {
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'permission_missing' });
    }
    const role = user.platformRole;
    if (role !== 'support' && role !== 'super_admin') {
      throw new AppError('ADMIN_FORBIDDEN', { reason: 'not_staff' });
    }
    const d = can({ surface: 'admin', platformRole: role }, meta.permission);
    if (!d.allow) throw new AppError('ADMIN_FORBIDDEN', { reason: 'permission_missing' });
    await next();
  };
}
