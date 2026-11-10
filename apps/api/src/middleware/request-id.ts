// X-Request-Id (040 §5.3): gelen değer yalnız ^[A-Za-z0-9-]{8,64}$ ise kabul edilir, aksi hâlde uuidv7 üretilir.
import { randomBytes } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';

const VALID = /^[A-Za-z0-9-]{8,64}$/;

/** RFC 9562 UUIDv7: 48 bit milisaniye zaman damgası + rastgele bitler. */
export function uuidv7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function requestId(): MiddlewareHandler<SurfaceEnv> {
  return async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const id = incoming !== undefined && VALID.test(incoming) ? incoming : uuidv7();
    c.set('requestId', id);
    await next();
    c.header('X-Request-Id', id);
  };
}
