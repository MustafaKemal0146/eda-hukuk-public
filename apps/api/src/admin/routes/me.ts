// `GET /api/v1/admin/me` (042 §10; P27a): oturumun personel bilgisi, ortam ve step-up penceresi. Yazma
// rotaları `stepUp: true` ister; pencere passkey ile yeniden giriş yapınca yenilenir.
import { AdminMeDto } from '@eda/contracts/api/admin';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import { stepUpExpiresAt, stepUpValid } from '../../auth/step-up.ts';
import type { SurfaceEnv } from '../../context/types.ts';
import { send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';

export const ADMIN_READ: RouteMeta = {
  permission: 'self',
  tenant: 'none',
  allowVerification: 'any',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

export function mountAdminMe(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  opts: { environment: string; maintenanceMode: () => boolean; now?: () => number },
): void {
  const now = opts.now ?? Date.now;
  registry.add('get', '/api/v1/admin/me', ADMIN_READ);
  app.get('/api/v1/admin/me', (c) => {
    const user = c.get('user');
    const session = c.get('session');
    const expiresAt = c.get('adminSessionExpiresAt');
    if (user === undefined || session === undefined || expiresAt === undefined) {
      throw new AppError('AUTH_UNAUTHENTICATED');
    }
    const role = user.platformRole;
    if (role !== 'super_admin' && role !== 'support') throw new AppError('AUTH_FORBIDDEN');
    const valid = stepUpValid(session.stepUpAt, now());
    return send(c, AdminMeDto, {
      userId: user.id,
      name: c.get('adminName') ?? '',
      platformRole: role,
      environment: opts.environment,
      maintenanceMode: opts.maintenanceMode(),
      session: {
        // Gate yalnız passkey|totp oturumunu geçirir; yine de dar tür için doğrulanır.
        mfaLevel: session.mfaLevel === 'totp' ? 'totp' : 'passkey',
        expiresAt: expiresAt.toISOString(),
        stepUpValidUntil:
          valid && session.stepUpAt !== null
            ? stepUpExpiresAt(session.stepUpAt).toISOString()
            : null,
      },
    });
  });
}
