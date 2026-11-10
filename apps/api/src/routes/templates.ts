// `GET /api/v1/templates` (041 §5.6; P17b.9): salt okuma. Platform şablonları araştırma izniyle
// açıktır (meslek doğrulaması bekleyen kullanıcıya yalnız bunlar döner); içerik bu uçta yoktur.
import { ListTemplatesQuery, TemplateListResponse } from '@eda/contracts/api/documents';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { DocumentsService } from '../services/documents/documents.ts';
import { queryOf, send, tenantActor } from './helpers.ts';

const META: RouteMeta = {
  permission: 'research:use',
  tenant: 'required',
  allowVerification: 'pending',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

export function mountTemplates(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: DocumentsService,
) {
  registry.add('get', '/api/v1/templates', META);
  app.get('/api/v1/templates', async (c) =>
    send(
      c,
      TemplateListResponse,
      await svc.listTemplates(tenantActor(c), queryOf(c, ListTemplatesQuery)),
    ),
  );
}
