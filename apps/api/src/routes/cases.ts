// `/api/v1/cases*` (041 §4; P20 ilk dilim). Oluşturma "ilk müvekkil verisi anı"dır (`clientData`,
// 042 §5.1): MFA politikası burada uygulanır. Yanıtlar `Cache-Control: no-store`.
import {
  CaseDto,
  CaseInput,
  CaseListResponse,
  CasePatchInput,
  ListCasesQuery,
} from '@eda/contracts/api/cases';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { CasesService } from '../services/cases/cases.ts';
import { jsonBody, queryOf, send, tenantActor } from './helpers.ts';

const READ: RouteMeta = {
  permission: 'case:read',
  tenant: 'required',
  allowVerification: 'verified',
  mfa: 'policy',
  clientData: false,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};
const WRITE: RouteMeta = { ...READ, permission: 'case:write', body: 'json' };

export function mountCases(app: Hono<SurfaceEnv>, registry: RouteRegistry, svc: CasesService) {
  const base = '/api/v1/cases';

  registry.add('get', base, READ);
  app.get(base, async (c) =>
    send(c, CaseListResponse, await svc.list(tenantActor(c), queryOf(c, ListCasesQuery))),
  );

  registry.add('post', base, { ...WRITE, clientData: true });
  app.post(base, async (c) => {
    const input = await jsonBody(c, CaseInput);
    return send(c, CaseDto, await svc.create(tenantActor(c), input), 201);
  });

  registry.add('get', `${base}/{caseId}`, READ);
  app.get(`${base}/:caseId`, async (c) =>
    send(c, CaseDto, await svc.get(tenantActor(c), c.req.param('caseId'))),
  );

  registry.add('patch', `${base}/{caseId}`, WRITE);
  app.patch(`${base}/:caseId`, async (c) => {
    const input = await jsonBody(c, CasePatchInput);
    return send(c, CaseDto, await svc.patch(tenantActor(c), c.req.param('caseId'), input));
  });
}
