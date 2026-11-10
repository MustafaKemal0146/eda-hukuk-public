// Gövde sınırı ve içerik türü (040 §5.6). json rotalarında application/json dışı 415, sınır aşımı 413.
// Yükleme rotaları (body = upload) çok parçalı gövde alır; sınır `upload.maxMb` (002 §2 Caddy satırı:
// `/api/v1/kunye-checks` 50 MB). Dosya akış sınırı ve antivirüs P20'de.

import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { MiddlewareHandler } from 'hono';
import { bodyLimit as honoBodyLimit } from 'hono/body-limit';
import type { SurfaceDeps } from '../context/types.ts';

const WITH_BODY = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UPLOAD_PATHS: readonly string[] = ['/api/v1/kunye-checks'];
/**
 * Akışlı yükleme (033 §6): gövde ARA BELLEĞE ALINMAZ (Hono `bodyLimit` zincirlenmiş gövdeyi toplar).
 * `Content-Length` varsa dosya sınırı + 1 MiB zarf payı başlıktan denetlenir; asıl sınır ve sayaç
 * yükleme servisindedir (`upload.maxMb`, 413 `FILE_TOO_LARGE`).
 */
const STREAMING_UPLOAD_PATHS: readonly string[] = ['/api/v1/files'];
const ENVELOPE_BYTES = 1024 * 1024;

export function bodyLimit(deps: Pick<SurfaceDeps, 'jsonBodyMaxBytes'>): MiddlewareHandler {
  const limit = honoBodyLimit({
    maxSize: deps.jsonBodyMaxBytes,
    onError: () => {
      throw new AppError('VALIDATION_PAYLOAD_TOO_LARGE');
    },
  });
  const uploadLimit = honoBodyLimit({
    maxSize: CONFIG_DEFAULTS['upload.maxMb'] * 1024 * 1024,
    onError: () => {
      throw new AppError('FILE_TOO_LARGE');
    },
  });
  return async (c, next) => {
    if (!WITH_BODY.has(c.req.method)) return next();
    const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
    // Gövdesiz istek: uzunluk sıfır ya da içerik türü, uzunluk ve parçalı aktarım başlıklarının
    // hiçbiri yok (tarayıcının gövdesiz DELETE'i). Aksi hâlde silme uçları 415 dönerdi.
    const length = c.req.header('content-length');
    const bare =
      length === undefined && type === '' && c.req.header('transfer-encoding') === undefined;
    const hasBody = c.req.raw.body !== null && length !== '0' && !bare;
    if (
      hasBody &&
      type === 'multipart/form-data' &&
      c.req.method === 'POST' &&
      STREAMING_UPLOAD_PATHS.includes(c.req.path)
    ) {
      const declared = Number(length);
      if (
        length !== undefined &&
        Number.isFinite(declared) &&
        declared > CONFIG_DEFAULTS['upload.maxMb'] * 1024 * 1024 + ENVELOPE_BYTES
      ) {
        throw new AppError('FILE_TOO_LARGE', {
          meta: { maxBytes: CONFIG_DEFAULTS['upload.maxMb'] * 1024 * 1024 },
        });
      }
      return next();
    }
    if (hasBody && type === 'multipart/form-data' && UPLOAD_PATHS.includes(c.req.path)) {
      return uploadLimit(c, next);
    }
    if (hasBody && type !== 'application/json') {
      throw new AppError('VALIDATION_UNSUPPORTED_MEDIA_TYPE');
    }
    return limit(c, next);
  };
}
