// `GET /api/v1/announcements` (041 §7; 002 §15): şu an etkin platform duyuruları, salt okur. Bakım
// modunda da çalışır (040 §5.5 istisnası) ve MFA kapısından muaftır (042 §5.1 `Mx`). Yazma uçları
// yönetim yüzeyindedir (`/api/v1/admin/announcements`, `:8010`).
import { AnnouncementListResponse } from '@eda/contracts/api/announcements';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { AnnouncementsService } from '../services/announcements/active.ts';
import { send, tenantActor } from './helpers.ts';

const READ: RouteMeta = {
  permission: 'self',
  tenant: 'required',
  allowVerification: 'any',
  mfa: 'exempt',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

export function mountAnnouncements(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AnnouncementsService,
) {
  registry.add('get', '/api/v1/announcements', READ);
  app.get('/api/v1/announcements', async (c) =>
    send(c, AnnouncementListResponse, await svc.listActive(tenantActor(c))),
  );
}
