// Hata işleyici (040 §6.2) ve notFound. Tüm /api/v1/* hataları 044 zarfıyla döner; istisna metni,
// yığın izi veya iç ayrıntı yanıta yazılmaz. 429 ve 503 Retry-After taşır.

import { AppError, type ErrorCode, httpStatusOf, toEnvelope } from '@eda/contracts/errors';
import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { SurfaceDeps, SurfaceEnv } from '../context/types.ts';

/** Kod başına Retry-After (sn). RATE_LIMITED değeri hız sınırı ara katmanınca (P04) verilir. */
const RETRY_AFTER_SEC: Partial<Record<ErrorCode, number>> = {
  INTERNAL_MAINTENANCE: 30,
  INTERNAL_DEPENDENCY_UNAVAILABLE: 2,
};

function respond(c: Context<SurfaceEnv>, err: AppError): Response {
  const requestId = c.get('requestId');
  const status = httpStatusOf(err.code) ?? 500;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Request-Id': requestId,
  };
  // Kaynak hatalarında bekleme yanıt meta verisindedir (SOURCE_BUSY/RATE_LIMITED/UNAVAILABLE).
  const metaRetry = err.meta?.retryAfterSec;
  const retry = typeof metaRetry === 'number' ? metaRetry : RETRY_AFTER_SEC[err.code];
  // 429/503 ve meta'da bekleme taşıyan diğer hatalar (ör. 409 idempotency işlemde; 040 §10).
  if (retry !== undefined && (status === 429 || status === 503 || typeof metaRetry === 'number'))
    headers['Retry-After'] = String(retry);
  return new Response(JSON.stringify(toEnvelope(err, requestId)), { status, headers });
}

/** Hata zincirinde PG SQLSTATE (Drizzle `cause` sarmalayıcısı dahil); yoksa null. */
export function pgCodeOf(err: unknown): string | null {
  let e: unknown = err;
  for (let i = 0; i < 5 && e !== null && typeof e === 'object'; i += 1) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    e = (e as { cause?: unknown }).cause;
  }
  return null;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  // Koltuk tetikleyicisi (042 §4.3; 040 §6.2).
  if (pgCodeOf(err) === 'EDA01')
    return new AppError('SEAT_LIMIT_REACHED', { reason: 'seat_limit' });
  if (err instanceof HTTPException && err.status === 413)
    return new AppError('VALIDATION_PAYLOAD_TOO_LARGE');
  if (err instanceof SyntaxError) return new AppError('VALIDATION_MALFORMED_BODY');
  return new AppError('INTERNAL_ERROR');
}

export function errorHandler(
  deps: Pick<SurfaceDeps, 'logger' | 'surface'>,
): ErrorHandler<SurfaceEnv> {
  return (err, c) => {
    const appError = toAppError(err);
    const status = httpStatusOf(appError.code) ?? 500;
    const entry = { surface: deps.surface, code: appError.code, requestId: c.get('requestId') };
    if (status >= 500 && appError.code !== 'INTERNAL_MAINTENANCE') {
      // Yalnız tür ve yığın; ileti değer içerebileceği için yazılmaz (040 §14).
      deps.logger.error({ ...entry, errorType: err.name, stack: err.stack });
    } else {
      deps.logger.info(entry);
    }
    return respond(c, appError);
  };
}

export function notFoundHandler(): NotFoundHandler<SurfaceEnv> {
  return (c) => respond(c, new AppError('VALIDATION_ROUTE_NOT_FOUND'));
}
