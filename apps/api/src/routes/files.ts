// `/api/v1/files*` ve `/api/v1/cases/{id}/files` (033 §6, §10, §11; 041). Yükleme akışlıdır: gövde
// `parseBody`/`formData` ile belleğe alınmaz, ayrıştırma/şifreleme/nesne yazımı servistedir. Yanıtlar
// `Cache-Control: no-store`; evrak adı hiçbir log/hata gövdesine yazılmaz. Presigned URL yoktur (D1).
import { Readable } from 'node:stream';
import type { ReadableStream as NodeWebStream } from 'node:stream/web';
import {
  DownloadTokenInput,
  DownloadTokenResponse,
  FileContentQuery,
  FileDeleteResponse,
  FileDto,
  FileListResponse,
  FileUploadResponse,
  ListCaseFilesQuery,
} from '@eda/contracts/api/files';
import { AppError } from '@eda/contracts/errors';
import type { Context, Hono } from 'hono';
import { clientIp, truncateIp } from '../auth/net.ts';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import type { FilesService } from '../services/files/files.ts';
import { optionalJsonBody, queryOf, send, tenantActor } from './helpers.ts';

const READ: RouteMeta = {
  permission: 'file:read',
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
const UPLOAD: RouteMeta = {
  ...READ,
  permission: 'file:upload',
  clientData: true,
  body: 'upload',
  timeout: 'upload',
};
// Silme: yükleyen kendi evrakını her rolde silebilir (trainee/assistant dahil); başkasının evrakı için
// `file:delete` denetimi serviste yapılır (033 §11). Kapı izni bu yüzden `file:upload` (ALL).
const REMOVE: RouteMeta = { ...READ, permission: 'file:upload' };

// İndirme belirteci üretimi: niyeti POST ile doğrular, veri değiştirmez (033 §10.4).
const TOKEN: RouteMeta = { ...READ, body: 'json' };

/** Oturum kimliği belirteci oturuma bağlar. */
function fileActor(c: Context<SurfaceEnv>) {
  return { ...tenantActor(c), sessionId: c.get('session')?.id };
}

export function mountFiles(app: Hono<SurfaceEnv>, registry: RouteRegistry, svc: FilesService) {
  const base = '/api/v1/files';

  registry.add('post', base, UPLOAD);
  app.post(base, async (c) => {
    const body = c.req.raw.body;
    if (body === null) throw new AppError('VALIDATION_MALFORMED_BODY');
    const length = c.req.header('content-length');
    const declared = length === undefined ? null : Number(length);
    const file = await svc.upload(tenantActor(c), {
      body: Readable.fromWeb(body as unknown as NodeWebStream<Uint8Array>),
      contentType: c.req.header('content-type') ?? '',
      contentLength: declared !== null && Number.isFinite(declared) ? declared : null,
      ipTrunc: truncateIp(clientIp(c.req.raw.headers)),
      requestId: c.get('requestId'),
    });
    return send(c, FileUploadResponse, { file }, 201);
  });

  registry.add('get', `${base}/{fileId}`, READ);
  app.get(`${base}/:fileId`, async (c) =>
    send(c, FileDto, await svc.get(tenantActor(c), c.req.param('fileId'))),
  );

  registry.add('delete', `${base}/{fileId}`, REMOVE);
  app.delete(`${base}/:fileId`, async (c) =>
    send(c, FileDeleteResponse, await svc.remove(tenantActor(c), c.req.param('fileId'))),
  );

  registry.add('post', `${base}/{fileId}/download-token`, TOKEN);
  app.post(`${base}/:fileId/download-token`, async (c) => {
    const input = await optionalJsonBody(c, DownloadTokenInput);
    return send(
      c,
      DownloadTokenResponse,
      await svc.issueDownloadToken(fileActor(c), c.req.param('fileId'), input.variant),
    );
  });

  // İndirme: custody `download` bayt akmadan önce yazılır; gövde segment doğrulandıkça akar (033 §10).
  registry.add('get', `${base}/{fileId}/content`, READ);
  app.get(`${base}/:fileId/content`, async (c) => {
    const query = queryOf(c, FileContentQuery);
    const result = await svc.openContent(fileActor(c), {
      fileId: c.req.param('fileId'),
      variant: query.variant,
      dt: query.dt,
      range: c.req.header('range'),
      ipTrunc: truncateIp(clientIp(c.req.raw.headers)),
    });
    if (result.kind === 'unsatisfiable') {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${result.size}`, 'Cache-Control': 'no-store' },
      });
    }
    const stream = Readable.toWeb(Readable.from(result.body)) as unknown as ReadableStream;
    return new Response(stream, { status: result.status, headers: result.headers });
  });

  registry.add('get', '/api/v1/cases/{caseId}/files', READ);
  app.get('/api/v1/cases/:caseId/files', async (c) =>
    send(
      c,
      FileListResponse,
      await svc.listForCase(tenantActor(c), c.req.param('caseId'), queryOf(c, ListCaseFilesQuery)),
    ),
  );
}
