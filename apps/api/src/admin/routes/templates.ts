// `/api/v1/admin/templates*` (salt okur): şablon envanteri ve sentetik düz metin önizleme.
import {
  AdminTemplateListResponse,
  AdminTemplatePreviewDto,
} from '@eda/contracts/api/admin-templates';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { send } from '../../routes/helpers.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { TemplatesService } from '../templates-service.ts';
import { STAFF_READ_META } from './staff-meta.ts';

const CODE_RE = /^[a-z][a-z0-9_]{0,63}$/;

export function mountAdminTemplates(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: TemplatesService,
): void {
  const base = '/api/v1/admin/templates';

  registry.add('get', base, STAFF_READ_META);
  app.get(base, async (c) => {
    const u = c.get('user');
    if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
    return send(c, AdminTemplateListResponse, await svc.list(u.id));
  });

  registry.add('get', `${base}/email/{code}/preview`, STAFF_READ_META);
  app.get(`${base}/email/:code/preview`, (c) => {
    const code = c.req.param('code');
    const p = CODE_RE.test(code) ? svc.preview(code) : null;
    if (p === null) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    return send(c, AdminTemplatePreviewDto, p);
  });
}
