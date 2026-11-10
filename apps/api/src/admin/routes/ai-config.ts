// `/api/v1/admin/ai/*` (Yapay zekâ ayarı ve istemler): katalog, son 7 gün kullanım özeti ve istem sürüm
// listesi salt okurdur (`platform:ai_catalog_read`, yalnız super_admin). Tek yazma ucu model etkin/pasif
// anahtarıdır (`platform:ai_catalog_write`, step-up). İstem metni düzenlenmez: istemler kodla sürümlenir
// ve golden önek testleriyle korunur; metin yalnız salt okur gösterilir. Yanıtlar `no-store`.
import {
  AdminAiCatalogResponse,
  AdminAiPromptsResponse,
  AdminAiPromptTextResponse,
  AdminAiUsageResponse,
  SetAiModelEnabledInput,
  SetAiModelEnabledResult,
} from '@eda/contracts/api/admin-ai';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../../context/types.ts';
import { jsonBody, send } from '../../routes/helpers.ts';
import type { RouteMeta } from '../../routing/define-route.ts';
import type { RouteRegistry } from '../../routing/route-registry.ts';
import type { AiConfigService } from '../ai-config-service.ts';
import { ADMIN_READ } from './me.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROMPT_KEY_RE = /^[a-z0-9_.]{3,64}$/;

const actorOf = (c: { get: (k: 'user') => unknown }): string => {
  const u = c.get('user') as { id: string } | undefined;
  if (u === undefined) throw new AppError('AUTH_UNAUTHENTICATED');
  return u.id;
};

export function mountAdminAiConfig(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: AiConfigService,
): void {
  const base = '/api/v1/admin/ai';
  const read: RouteMeta = { ...ADMIN_READ, permission: 'platform:ai_catalog_read' };
  const write: RouteMeta = {
    ...ADMIN_READ,
    permission: 'platform:ai_catalog_write',
    stepUp: true,
    body: 'json',
  };

  registry.add('get', `${base}/catalog`, read);
  app.get(`${base}/catalog`, async (c) =>
    send(c, AdminAiCatalogResponse, await svc.catalog(actorOf(c))),
  );

  registry.add('get', `${base}/usage`, read);
  app.get(`${base}/usage`, async (c) => send(c, AdminAiUsageResponse, await svc.usage(actorOf(c))));

  registry.add('get', `${base}/prompts`, read);
  app.get(`${base}/prompts`, (c) => send(c, AdminAiPromptsResponse, svc.prompts()));

  registry.add('get', `${base}/prompts/{key}`, read);
  app.get(`${base}/prompts/:key`, (c) => {
    const key = c.req.param('key');
    if (!PROMPT_KEY_RE.test(key)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    return send(c, AdminAiPromptTextResponse, svc.promptText(key));
  });

  registry.add('put', `${base}/models/{modelId}/enabled`, write);
  app.put(`${base}/models/:modelId/enabled`, async (c) => {
    const modelId = c.req.param('modelId');
    if (!UUID_RE.test(modelId)) throw new AppError('VALIDATION_ROUTE_NOT_FOUND');
    const input = await jsonBody(c, SetAiModelEnabledInput);
    return send(
      c,
      SetAiModelEnabledResult,
      await svc.setModelEnabled(actorOf(c), modelId, input.enabled),
    );
  });
}
