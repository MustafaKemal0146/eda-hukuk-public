// Kayıtlı rotaların meta verisi (040 §4, route census). Aynı metot + yol iki kez kaydedilemez.
// P04a (KK-P04a-8): her rota izni `PERMISSIONS` kaydında veya `public`/`self` olmalı; `public` yalnız
// 040 §5.9 listesindeki rotalarda; kurulu olmayan ara katmana bağımlı rota kaydı başlatma hatasıdır
// (fail-closed). P04b (KK-P04b-10): `mfaGate`, `stepUp`, `idempotency` kuruludur; izni step-up
// isteyen (`PERMISSIONS[izin].stepUp`) rota `stepUp: true` taşır ve tersi (042 §6.2; `self` rotalarda
// `STEP_UP_SELF_ROUTES`); `clientData: true` yalnız 042 §5.1 listesindeki rotalarda; idempotent rota
// yanıt şemasını verir ve şemada serbest metin alanı bulunamaz (040 §10). Geliştirme dilimi rotaları (/0065/0066/
// 0068; yalnız development/test'te bağlanır) kimlik zincirinden muaftır ve census kurallarına
// tabi değildir; P04b/P04c ile zincire alınır.
import { isPermission, isRoutePermission, PERMISSIONS } from '@eda/contracts/permissions';
import { z } from 'zod';
import { CLIENT_DATA_ROUTES } from '../auth/mfa-policy.ts';
import { RouteDefinitionError, type RouteMeta } from './define-route.ts';
import { isPublicRoute } from './public-routes.ts';

/** Bu sürümde kurulu ara katmanlar (040 §5.1; P04b ile tam zincir). */
export const INSTALLED_GATES = [
  'originCheck',
  'rateLimit',
  'session',
  'verificationGate',
  'tenant',
  'mfaGate',
  'authorize',
  'stepUp',
  'idempotency',
] as const;
export type Gate = (typeof INSTALLED_GATES)[number];

/** İzni `self` olup step-up isteyen rotalar (042 §6.2; ör. veri dışa aktarımı). */
export const STEP_UP_SELF_ROUTES: readonly string[] = ['POST /api/v1/me/data-exports'];

/** Rotanın izin tablosuna göre step-up gerektirip gerektirmediği (KK-042-12 census). */
export function stepUpExpected(method: string, path: string, permission: string): boolean {
  if (isPermission(permission)) return PERMISSIONS[permission].stepUp;
  return STEP_UP_SELF_ROUTES.includes(`${method.toUpperCase()} ${path}`);
}

/**
 * Yanıt şeması serbest metin taşıyor mu (040 §10): kısıtsız `string` (desen, biçim, enum veya sabit
 * olmayan) serbest metindir.
 */
export function freeTextFields(schema: z.ZodType): string[] {
  const out: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.type === 'string' && n.pattern === undefined && n.format === undefined) {
      if (n.enum === undefined && n.const === undefined) out.push(path || '$');
    }
    for (const [k, v] of Object.entries((n.properties as Record<string, unknown>) ?? {})) {
      walk(v, `${path}.${k}`);
    }
    if (n.items !== undefined) walk(n.items, `${path}[]`);
    for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
      const list = n[key];
      if (Array.isArray(list)) for (const x of list) walk(x, path);
    }
  };
  walk(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }), '');
  return out;
}

export type RegisteredRoute = {
  method: string;
  path: string;
  meta: RouteMeta;
  devSlice: boolean;
};

export interface RegisterOptions {
  /** Geliştirme dilimi rotası: kimlik zinciri ve census muafiyeti. */
  readonly devSlice?: boolean;
  /** Başarılı yanıt şeması; `idempotency ≠ none` rotada zorunlu (serbest metin denetimi). */
  readonly response?: z.ZodType;
}

/** Rota meta verisinin gerektirdiği ara katmanlar. */
export function requiredGates(meta: RouteMeta): Gate[] {
  const out: Gate[] = [];
  if (meta.mfa === 'policy') out.push('mfaGate');
  if (meta.stepUp) out.push('stepUp');
  if (meta.idempotency !== 'none') out.push('idempotency');
  return out;
}

function compile(path: string): RegExp {
  const body = path
    .split('/')
    .map((seg) =>
      /^\{[A-Za-z]+\}$/.test(seg) ? '[^/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp(`^${body}/?$`);
}

export class RouteRegistry {
  readonly #routes = new Map<string, RegisteredRoute & { re: RegExp }>();
  readonly #installed: ReadonlySet<Gate>;

  constructor(installed: readonly Gate[] = INSTALLED_GATES) {
    this.#installed = new Set(installed);
  }

  add(method: string, path: string, meta: RouteMeta | undefined, opts: RegisterOptions = {}): void {
    const key = `${method.toUpperCase()} ${path}`;
    if (meta === undefined) throw new Error(`rota meta verisi eksik: ${key}`);
    if (this.#routes.has(key)) throw new Error(`rota iki kez kaydedildi: ${key}`);
    const devSlice = opts.devSlice === true;
    if (!devSlice) {
      if (!isRoutePermission(meta.permission)) {
        throw new RouteDefinitionError(`bilinmeyen izin adı (${meta.permission}): ${key}`);
      }
      if (meta.permission === 'public' && !isPublicRoute(method, path)) {
        throw new RouteDefinitionError(`public izin yalnız 040 §5.9 listesinde: ${key}`);
      }
      const missing = requiredGates(meta).filter((g) => !this.#installed.has(g));
      if (missing.length > 0) {
        throw new RouteDefinitionError(
          `rota kurulu olmayan ara katmana bağımlı (${missing.join(', ')}): ${key}`,
        );
      }
      if (meta.stepUp !== stepUpExpected(method, path, meta.permission)) {
        throw new RouteDefinitionError(`step-up meta verisi izin tablosuyla uyuşmuyor: ${key}`);
      }
      if (meta.clientData !== CLIENT_DATA_ROUTES.includes(key)) {
        throw new RouteDefinitionError(
          `clientData meta verisi 042 §5.1 listesiyle uyuşmuyor: ${key}`,
        );
      }
      if (meta.idempotency !== 'none') {
        if (opts.response === undefined) {
          throw new RouteDefinitionError(`idempotent rota yanıt şeması vermeli: ${key}`);
        }
        const free = freeTextFields(opts.response);
        if (free.length > 0) {
          throw new RouteDefinitionError(
            `idempotent rota yanıtında serbest metin alanı var (${free.join(', ')}): ${key}`,
          );
        }
      }
    }
    this.#routes.set(key, {
      method: method.toUpperCase(),
      path,
      meta,
      devSlice,
      re: compile(path),
    });
  }

  list(): readonly RegisteredRoute[] {
    return [...this.#routes.values()].map(({ re: _re, ...r }) => r);
  }

  /** İstek yöntemi + yoluyla eşleşen kayıt (OpenAPI `{param}` şablonları). */
  find(method: string, path: string): RegisteredRoute | undefined {
    const m = method.toUpperCase();
    for (const r of this.#routes.values()) {
      if (r.method === m && r.re.test(path)) {
        const { re: _re, ...out } = r;
        return out;
      }
    }
    return undefined;
  }
}

/**
 * Yönetim yüzeyi açılış denetimi (fail-closed; D-7): `/api/v1/*` altında Hono'ya bağlanan her rota
 * kayıt defterinde olmalı (aksi hâlde `adminSession`/`adminAuthorize` meta verisi bulamaz ve
 * `next()` ile geçerdi), geliştirme dilimi (kimlik zincirinden muaf) olamaz ve izni `self` ya da
 * `platform:*` olmalıdır (`public` yok). Aksi hâlde uygulama BAŞLAMAZ.
 */
export function assertAdminRoutesGuarded(
  routes: readonly { method: string; path: string }[],
  registry: RouteRegistry,
): void {
  for (const r of routes) {
    if (!r.path.startsWith('/api/v1/') || r.path.endsWith('*') || r.method === 'ALL') continue;
    const template = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const found = registry.list().find((x) => x.method === r.method && x.path === template);
    if (found === undefined) {
      throw new Error(`yönetim rotası kayıt defterinde yok: ${r.method} ${r.path}`);
    }
    if (found.devSlice) {
      throw new Error(`yönetim rotası geliştirme dilimi olamaz: ${r.method} ${r.path}`);
    }
    const p = found.meta.permission;
    if (p !== 'self' && !(typeof p === 'string' && p.startsWith('platform:'))) {
      throw new Error(`yönetim rotası izni self veya platform:* olmalı: ${r.method} ${r.path}`);
    }
  }
}
