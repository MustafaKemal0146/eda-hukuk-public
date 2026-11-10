// `/api/v1/documents*` uçları (041 §5.4; 054 §8–§10; P17b). Rota katmanı yalnız ayrıştırma ve
// yanıt doğrulamasıdır; kural ve SQL servis/depo katmanındadır. Yanıtlar `Cache-Control: no-store`.
// `clientData` yalnız belge oluşturmada (041 `CD`); idempotency bu uçlarda yoktur (yanıt şemasında
// serbest metin bulunur, 040 §10). `PUT …/draft` gövdesi `http.jsonBodyMaxBytes` altında kalır.
import {
  CreateDocumentInput,
  CreateVersionInput,
  DiffQuery,
  DocumentDto,
  DocumentListResponse,
  DocumentVersionContentDto,
  DocumentVersionDto,
  DocumentVersionListResponse,
  ListDocumentsQuery,
  ListVersionsQuery,
  PatchDocumentInput,
  RestoreVersionResponse,
} from '@eda/contracts/api/documents';
import {
  DraftSaveRequest,
  DraftSaveResponse,
  VersionDiffResponse,
} from '@eda/contracts/document-io';
import type { Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { DocumentsService } from '../services/documents/documents.ts';
import { jsonBody, optionalJsonBody, queryOf, send, tenantActor } from './helpers.ts';

const READ: RouteMeta = {
  permission: 'document:read',
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
const WRITE: RouteMeta = { ...READ, permission: 'document:write', body: 'json' };

export function mountDocuments(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  svc: DocumentsService,
) {
  const base = '/api/v1/documents';

  registry.add('get', base, READ);
  app.get(base, async (c) =>
    send(c, DocumentListResponse, await svc.list(tenantActor(c), queryOf(c, ListDocumentsQuery))),
  );

  registry.add('post', base, { ...WRITE, clientData: true });
  app.post(base, async (c) => {
    const input = await jsonBody(c, CreateDocumentInput);
    return send(c, DocumentDto, await svc.create(tenantActor(c), input), 201);
  });

  registry.add('get', `${base}/{documentId}`, READ);
  app.get(`${base}/:documentId`, async (c) =>
    send(c, DocumentDto, await svc.get(tenantActor(c), c.req.param('documentId'))),
  );

  registry.add('patch', `${base}/{documentId}`, WRITE);
  app.patch(`${base}/:documentId`, async (c) => {
    const input = await jsonBody(c, PatchDocumentInput);
    return send(c, DocumentDto, await svc.patch(tenantActor(c), c.req.param('documentId'), input));
  });

  registry.add('delete', `${base}/{documentId}`, { ...READ, permission: 'document:delete' });
  app.delete(`${base}/:documentId`, async (c) => {
    await svc.remove(tenantActor(c), c.req.param('documentId'));
    c.header('Cache-Control', 'no-store');
    return c.body(null, 204);
  });

  registry.add('put', `${base}/{documentId}/draft`, WRITE);
  app.put(`${base}/:documentId/draft`, async (c) => {
    const input = await jsonBody(c, DraftSaveRequest);
    return send(
      c,
      DraftSaveResponse,
      await svc.saveDraft(tenantActor(c), c.req.param('documentId'), input),
    );
  });

  registry.add('get', `${base}/{documentId}/versions`, READ);
  app.get(`${base}/:documentId/versions`, async (c) =>
    send(
      c,
      DocumentVersionListResponse,
      await svc.listVersions(
        tenantActor(c),
        c.req.param('documentId'),
        queryOf(c, ListVersionsQuery),
      ),
    ),
  );

  registry.add('post', `${base}/{documentId}/versions`, WRITE);
  app.post(`${base}/:documentId/versions`, async (c) => {
    const input = await optionalJsonBody(c, CreateVersionInput);
    const r = await svc.createVersion(tenantActor(c), c.req.param('documentId'), input);
    return send(c, DocumentVersionDto, r.version, r.created ? 201 : 200);
  });

  registry.add('get', `${base}/{documentId}/versions/{versionId}`, READ);
  app.get(`${base}/:documentId/versions/:versionId`, async (c) =>
    send(
      c,
      DocumentVersionContentDto,
      await svc.getVersion(tenantActor(c), c.req.param('documentId'), c.req.param('versionId')),
    ),
  );

  registry.add('post', `${base}/{documentId}/versions/{versionId}/restore`, {
    ...WRITE,
    body: 'none',
  });
  app.post(`${base}/:documentId/versions/:versionId/restore`, async (c) =>
    send(
      c,
      RestoreVersionResponse,
      await svc.restoreVersion(tenantActor(c), c.req.param('documentId'), c.req.param('versionId')),
      201,
    ),
  );

  registry.add('get', `${base}/{documentId}/diff`, READ);
  app.get(`${base}/:documentId/diff`, async (c) =>
    send(
      c,
      VersionDiffResponse,
      await svc.diff(tenantActor(c), c.req.param('documentId'), queryOf(c, DiffQuery)),
    ),
  );
}
