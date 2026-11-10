// Oturum yönetimi (P23; 042 §2.5): `GET /api/v1/me/sessions`, `DELETE /api/v1/me/sessions/{id}`,
// `POST /api/v1/me/sessions/revoke-others`. Better Auth `list-sessions` belirteç döndürdüğünden
// tarayıcıya kapalıdır; burada yalnız kimlik, zaman ve kısaltılmış ağ bilgisi döner. İptal kimlikle
// yapılır, belirteç sunucuda kalır. Her iptal `auth.session.revoked` denetim olayı yazar.
import { RevokeSessionsResult, SessionListResponse } from '@eda/contracts/api/me';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { AuditEvent } from '../../auth/audit.ts';
import type { Identity } from '../../auth/index.ts';
import type { SurfaceEnv } from '../../context/types.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import { send } from '../helpers.ts';
import { ME_META } from './index.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mountSessions(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  identity: Pick<Identity, 'listSessions' | 'revokeSessionById' | 'revokeOtherSessions'>,
  audit: (e: AuditEvent) => Promise<void>,
): void {
  const base = '/api/v1/me/sessions';
  const who = (c: { get: (k: 'session') => unknown }) => {
    const s = c.get('session') as { id: string; userId: string } | undefined;
    if (s === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
    return s;
  };

  registry.add('get', base, ME_META);
  app.get(base, async (c) => {
    const s = who(c);
    const rows = await identity.listSessions(s.userId);
    return send(c, SessionListResponse, {
      items: rows.map((r) => ({
        id: r.id,
        current: r.id === s.id,
        createdAt: r.createdAt.toISOString(),
        lastActiveAt: r.updatedAt.toISOString(),
        expiresAt: r.expiresAt.toISOString(),
        ipTrunc: r.ipAddress,
        userAgent: r.userAgent,
      })),
    });
  });

  registry.add('post', `${base}/revoke-others`, { ...ME_META, body: 'none' });
  app.post(`${base}/revoke-others`, async (c) => {
    const s = who(c);
    const revoked = await identity.revokeOtherSessions(s.userId, s.id);
    await audit({
      action: 'auth.session.revoked',
      userId: s.userId,
      targetType: 'user',
      targetId: s.userId,
      metadata: { scope: 'others', count: revoked },
    });
    return send(c, RevokeSessionsResult, { revoked });
  });

  registry.add('delete', `${base}/{sessionId}`, ME_META);
  app.delete(`${base}/:sessionId`, async (c) => {
    const s = who(c);
    const id = c.req.param('sessionId');
    // Geçerli oturum buradan kapatılmaz (çıkış ayrı akıştır); başka kullanıcının oturumu 404.
    if (!UUID_RE.test(id) || id === s.id) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    if (!(await identity.revokeSessionById(s.userId, id))) {
      throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    }
    await audit({
      action: 'auth.session.revoked',
      userId: s.userId,
      targetType: 'session',
      targetId: id,
      metadata: { scope: 'one' },
    });
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });
}
