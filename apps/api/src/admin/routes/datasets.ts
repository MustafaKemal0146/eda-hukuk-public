// `GET /api/v1/admin/datasets` (salt okur): karar arşivi ve mevzuat kaynak durumu. Yükleme/silme yok.
import { AdminDatasetsDto } from '@eda/contracts/api/admin-datasets';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { send } from '../../routes/helpers.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { DatasetsService } from '../datasets-service.ts';
import { STAFF_READ_META } from './staff-meta.ts';

export function mountAdminDatasets(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: DatasetsService,
): void {
  registry.add('get', '/api/v1/admin/datasets', STAFF_READ_META);
  app.get('/api/v1/admin/datasets', async (c) => {
    const u = c.get('user');
    if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
    return send(c, AdminDatasetsDto, await svc.overview(u.id));
  });
}
