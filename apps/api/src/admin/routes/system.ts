// `GET /api/v1/admin/system` (Sistem modülü): servis durumu, önbellek, kuyruk ve veritabanı özeti.
// Salt okur; değiştirici uç yoktur (bakım modu, önbellek temizleme vb. bu modülde bulunmaz). İzin
// `platform:system_settings_read` (süper yönetici; 042 §8). Yanıt `no-store`; içerik taşımaz.
import { AdminSystemDto } from '@eda/contracts/api/admin-system';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { SystemService } from '../system-service.ts';
import { ADMIN_READ } from './me.ts';

export function mountAdminSystem(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: SystemService,
): void {
  const meta: RouteMeta = { ...ADMIN_READ, permission: 'platform:system_settings_read' };
  registry.add('get', '/api/v1/admin/system', meta);
  app.get('/api/v1/admin/system', async (c) => {
    const u = c.get('user');
    if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
    return send(c, AdminSystemDto, await svc.system(u.id));
  });
}
