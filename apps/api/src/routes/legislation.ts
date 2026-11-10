// Mevzuat uçları (002 §15; 041 §5.3). : korpus (P15) gelene dek canlı kaynaktan; yalnız
// development/test'te bağlanır. Katalog (`GET …/laws`) ve madde dizini (`…/articles`) korpus ister,
// kaydedilmez. Arama sorgusu gövdede; kalıcı saklanmaz.
import {
  ArticleNoParam,
  ArticleQuery,
  LawNoParam,
  LawQuery,
  LegislationSearchRequest,
} from '@eda/contracts/api';
import { AppError } from '@eda/contracts/errors';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';

/** Geliştirme dilimi: kimlik zinciri ve census muafiyeti; yalnız development/test. */
const DEV_SLICE = { devSlice: true } as const;

import type { LegislationService } from '../services/legislation/legislation.ts';
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

function lawNoParam(raw: string): string {
  if (!LawNoParam.safeParse(raw).success) {
    throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'law' });
  }
  return raw;
}

function articleNoParam(raw: string): string {
  if (!ArticleNoParam.safeParse(raw).success) {
    throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'article' });
  }
  return raw;
}

export function mountLegislation(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  legislation: LegislationService,
  authed = false,
): void {
  // Kimlik zinciri kuruluysa oturum + büro kapısından geçer; kamu araçları `pending` kullanıcıya açıktır.
  const META: RouteMeta = authed
    ? { ...BASE_META, tenant: 'required', clientData: false }
    : BASE_META;
  const opts = authed ? undefined : DEV_SLICE;
  const base = '/api/v1/legislation';

  registry.add('post', `${base}/search`, { ...META, body: 'json' }, opts);
  app.post(`${base}/search`, async (c) => {
    const body = await parseJsonBody(LegislationSearchRequest, c.req.raw);
    return c.json(await legislation.search(body, c.req.raw.signal));
  });

  registry.add('get', `${base}/laws/{lawNo}`, META, opts);
  app.get(`${base}/laws/:lawNo`, async (c) => {
    const lawNo = lawNoParam(c.req.param('lawNo'));
    const q = parseQuery(LawQuery, c.req.query());
    return c.json(await legislation.getLaw(lawNo, q.type ?? null, c.req.raw.signal));
  });

  registry.add('get', `${base}/laws/{lawNo}/articles/{articleNo}`, META, opts);
  app.get(`${base}/laws/:lawNo/articles/:articleNo`, async (c) => {
    const lawNo = lawNoParam(c.req.param('lawNo'));
    const articleNo = articleNoParam(c.req.param('articleNo'));
    const q = parseQuery(ArticleQuery, c.req.query());
    return c.json(
      await legislation.getArticle(
        lawNo,
        articleNo,
        q.type ?? null,
        q.asOf ?? null,
        c.req.raw.signal,
      ),
    );
  });
}
