// Rota tanımı sözleşmesi (040 §4): @hono/zod-openapi createRoute sarmalayıcısı. Yetki meta verisi
// zorunludur; eksikse tanım anında hata (varsayılan kapalı). Varsayılanlar 040 §4 tablosundan.
import { createRoute, type RouteConfig } from '@hono/zod-openapi';

export const TENANT_MODES = ['required', 'optional', 'none'] as const;
export const VERIFICATION_MODES = ['verified', 'pending', 'any'] as const;
export const MFA_MODES = ['policy', 'exempt'] as const;
export const IDEMPOTENCY_MODES = ['required', 'optional', 'none'] as const;
export const RATE_LIMIT_SCOPES = ['api', 'chat', 'kvkkPreview', 'none'] as const;
export const BODY_KINDS = ['json', 'upload', 'none'] as const;
export const TIMEOUT_KINDS = ['default', 'stream', 'upload'] as const;

export type RouteMeta = {
  /** 042 izin adı | 'public' | 'self'. Zorunlu. */
  permission: string;
  tenant: (typeof TENANT_MODES)[number];
  allowVerification: (typeof VERIFICATION_MODES)[number];
  mfa: (typeof MFA_MODES)[number];
  clientData: boolean;
  stepUp: boolean;
  idempotency: (typeof IDEMPOTENCY_MODES)[number];
  rateLimit: (typeof RATE_LIMIT_SCOPES)[number];
  body: (typeof BODY_KINDS)[number];
  timeout: (typeof TIMEOUT_KINDS)[number];
};

export type RouteMetaInput = Pick<RouteMeta, 'permission'> & Partial<Omit<RouteMeta, 'permission'>>;

export class RouteDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteDefinitionError';
  }
}

export type DefinedRoute<R extends RouteConfig> = R & { meta: RouteMeta };

export function defineRoute<const R extends RouteConfig>(
  config: R & { meta: RouteMetaInput },
): DefinedRoute<R> {
  const input = config.meta as Partial<RouteMetaInput> | undefined;
  if (input === undefined || typeof input.permission !== 'string' || input.permission === '') {
    throw new RouteDefinitionError(
      `rota yetki meta verisi eksik: ${config.method.toUpperCase()} ${config.path}`,
    );
  }
  const meta: RouteMeta = {
    permission: input.permission,
    tenant: input.tenant ?? 'required',
    allowVerification: input.allowVerification ?? 'verified',
    mfa: input.mfa ?? 'policy',
    clientData: input.clientData ?? false,
    stepUp: input.stepUp ?? false,
    idempotency: input.idempotency ?? 'none',
    rateLimit: input.rateLimit ?? 'api',
    body: input.body ?? (config.method === 'get' ? 'none' : 'json'),
    timeout: input.timeout ?? 'default',
  };
  return { ...createRoute(config), meta } as DefinedRoute<R>;
}
