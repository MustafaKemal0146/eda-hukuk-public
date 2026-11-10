// Karar Arşivi uçları (002 §15; 041 §5.2). : kimlik (P04) ve DB (P03) gelene dek yalnız
// development/test'te bağlanır, arama kaydı bellek içidir; üretim derlemesinde bu yüzey kayıtsızdır.
// Sorgu yalnız gövdede taşınır (`?q=` GEÇERSİZ); canlı arama yalnız `POST …/live` ile.
import { DecisionSearchRequest, LiveSearchRequest, SearchPageQuery } from '@eda/contracts/api';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';

/** Geliştirme dilimi: kimlik zinciri ve census muafiyeti; yalnız development/test. */
const DEV_SLICE = { devSlice: true } as const;
export type RouteMode = { authed: boolean };

import type { DecisionReader, DecisionService } from '../services/decisions/decisions.ts';
import { parseJsonBody, parseQuery } from './validate.ts';

const BASE_META: RouteMeta = {
  permission: 'research:use',
  tenant: 'none',
  allowVerification: 'pending',
  mfa: 'exempt',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function searchIdParam(id: string): string {
  if (!UUID.test(id))
    throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'decision_search' });
  return id;
}

function sectionNoParam(raw: string): number {
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) {
    throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'decision' });
  }
  return Number(raw);
}

export type DecisionRouteDeps = { decisions: DecisionService; reader: DecisionReader };

export function mountDecisions(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  deps: DecisionRouteDeps,
  authed = false,
): void {
  // Kimlik zinciri kuruluysa oturum + büro kapısından geçer; kamu araçları `pending` kullanıcıya açıktır.
  const META: RouteMeta = authed
    ? { ...BASE_META, tenant: 'required', clientData: false }
    : BASE_META;
  const opts = authed ? undefined : DEV_SLICE;
  const base = '/api/v1/decisions';

  registry.add('post', `${base}/search`, { ...META, body: 'json' }, opts);
  app.post(`${base}/search`, async (c) => {
    const body = await parseJsonBody(DecisionSearchRequest, c.req.raw);
    return c.json(deps.decisions.search(body), 201);
  });

  registry.add('get', `${base}/searches/{searchId}`, META, opts);
  app.get(`${base}/searches/:searchId`, (c) => {
    const id = searchIdParam(c.req.param('searchId'));
    const q = parseQuery(SearchPageQuery, c.req.query());
    return c.json(deps.decisions.getPage(id, q));
  });

  registry.add('post', `${base}/searches/{searchId}/live`, { ...META, body: 'json' }, opts);
  app.post(`${base}/searches/:searchId/live`, async (c) => {
    const id = searchIdParam(c.req.param('searchId'));
    const body = await parseJsonBody(LiveSearchRequest, c.req.raw, true);
    return c.json(await deps.decisions.requestLive(id, body.more, c.req.raw.signal));
  });

  registry.add('get', `${base}/{decisionId}`, META, opts);
  app.get(`${base}/:decisionId`, async (c) =>
    c.json(await deps.reader.getDecision(c.req.param('decisionId'), c.req.raw.signal)),
  );

  registry.add('get', `${base}/{decisionId}/sections/{sectionNo}`, META, opts);
  app.get(`${base}/:decisionId/sections/:sectionNo`, async (c) => {
    const n = sectionNoParam(c.req.param('sectionNo'));
    return c.json(await deps.reader.getSection(c.req.param('decisionId'), n, c.req.raw.signal));
  });
}
