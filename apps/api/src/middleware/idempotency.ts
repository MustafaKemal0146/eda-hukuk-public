// `idempotency` (040 §5.1 adım 16, §10; KK-P04b-9): `Idempotency-Key` başlığı (16–64,
// `^[A-Za-z0-9-]+$`). `required` rotada başlık yoksa 422 `VALIDATION_FAILED`
// (`idempotency_key_required`). Kayıt ana `valkey`'de `eda:idem:<orgId|none>:<userId>:<sha256(anahtar)>`:
//  - `SET NX` ile `in_progress` (`api.idempotencyLockSec`); kayıt `in_progress` -> 409
//    `VALIDATION_IDEMPOTENCY_IN_PROGRESS` + `Retry-After: 1`;
//  - `completed` ve aynı `route` + `rh` (kanonik gövde özeti) -> saklı durum + gövde,
//    `Idempotency-Replayed: true`, tekrar sayacı (`eda_idempotency_replays_total`);
//  - farklı `route`/`rh` -> 422 `VALIDATION_IDEMPOTENCY_KEY_REUSED`;
//  - işleyici sonrası 2xx/4xx `completed` olarak `api.idempotencyTtlHours` saklanır, 5xx/429'da silinir.
// Saklanan gövde yalnız kimlik + durum + enum taşır: idempotent rotanın yanıt şeması kayıtta serbest
// metin denetiminden geçer (route census; `route-registry.ts`). Valkey yoksa fail-closed 503.
import { createHash } from 'node:crypto';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { MiddlewareHandler } from 'hono';
import type { Redis } from 'ioredis';
import type { SurfaceEnv } from '../context/types.ts';

export const IDEM_PREFIX = 'eda:idem:';
export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
export const REPLAYED_HEADER = 'Idempotency-Replayed';

interface IdemRecord {
  readonly st: 'in_progress' | 'completed';
  readonly route: string;
  readonly rh: string;
  readonly status?: number;
  readonly body?: unknown;
}

export interface IdempotencyStore {
  claim(key: string, value: string, ttlSec: number): Promise<boolean>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
}

export function valkeyIdempotencyStore(redis: Redis): IdempotencyStore {
  return {
    async claim(key, value, ttlSec) {
      return (await redis.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
    },
    get: (key) => redis.get(key),
    async put(key, value, ttlSec) {
      await redis.set(key, value, 'EX', ttlSec);
    },
    async del(key) {
      await redis.del(key);
    },
  };
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** Anahtar sırası bağımsız JSON (gövde özeti için). */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

async function bodyHash(req: Request): Promise<string> {
  const text = await req.clone().text();
  if (text === '') return sha256('');
  try {
    return sha256(canonicalJson(JSON.parse(text)));
  } catch {
    return sha256(text);
  }
}

export interface IdempotencyCounters {
  readonly replays: () => number;
}

export function idempotency(
  store: IdempotencyStore,
): MiddlewareHandler<SurfaceEnv> & IdempotencyCounters {
  let replays = 0;
  const lockSec = CONFIG_DEFAULTS['api.idempotencyLockSec'];
  const ttlSec = CONFIG_DEFAULTS['api.idempotencyTtlHours'] * 3600;
  const unavailable = () => new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE');

  const mw: MiddlewareHandler<SurfaceEnv> = async (c, next) => {
    const meta = c.get('routeMeta');
    const session = c.get('session');
    if (meta === undefined || meta.idempotency === 'none' || session === undefined) return next();
    const header = c.req.header('idempotency-key');
    if (header === undefined) {
      if (meta.idempotency === 'required') {
        throw new AppError('VALIDATION_FAILED', { reason: 'idempotency_key_required' });
      }
      return next();
    }
    if (!IDEMPOTENCY_KEY_RE.test(header)) {
      throw new AppError('VALIDATION_FAILED', {
        fields: [{ path: 'header.Idempotency-Key', issue: 'invalid_format' }],
      });
    }
    const route = c.get('routeKey') ?? `${c.req.method} ${c.req.path}`;
    const rh = await bodyHash(c.req.raw);
    const orgId = c.get('tenant')?.orgId ?? 'none';
    const key = `${IDEM_PREFIX}${orgId}:${session.userId}:${sha256(header)}`;
    const pending: IdemRecord = { st: 'in_progress', route, rh };
    let claimed = false;
    for (let attempt = 0; attempt < 2 && !claimed; attempt += 1) {
      try {
        claimed = await store.claim(key, JSON.stringify(pending), lockSec);
      } catch {
        throw unavailable();
      }
      if (claimed) break;
      let raw: string | null;
      try {
        raw = await store.get(key);
      } catch {
        throw unavailable();
      }
      if (raw === null) continue;
      const rec = JSON.parse(raw) as IdemRecord;
      if (rec.route !== route || rec.rh !== rh) {
        throw new AppError('VALIDATION_IDEMPOTENCY_KEY_REUSED');
      }
      if (rec.st === 'in_progress') {
        throw new AppError('VALIDATION_IDEMPOTENCY_IN_PROGRESS', { meta: { retryAfterSec: 1 } });
      }
      replays += 1;
      return new Response(JSON.stringify(rec.body ?? null), {
        status: rec.status ?? 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          [REPLAYED_HEADER]: 'true',
        },
      });
    }
    if (!claimed)
      throw new AppError('VALIDATION_IDEMPOTENCY_IN_PROGRESS', { meta: { retryAfterSec: 1 } });
    await next();
    const status = c.res.status;
    try {
      if (status >= 500 || status === 429) {
        await store.del(key);
        return;
      }
      const body: unknown = await c.res
        .clone()
        .json()
        .catch(() => null);
      const done: IdemRecord = { st: 'completed', route, rh, status, body };
      await store.put(key, JSON.stringify(done), ttlSec);
    } catch {
      // Kayıt yazılamazsa kilit süresi dolunca anahtar yeniden kullanılabilir (yanıt değişmez).
    }
  };
  return Object.assign(mw, { replays: () => replays });
}
