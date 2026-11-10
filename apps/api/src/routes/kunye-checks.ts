// Künye Kontrolü uçları (002 §15; 025 §14; P13.12). : dosya alım/metin çıkarma portları
// (pdf/docx/udf) P19/P20 ile bağlanır; development/test'te düz metin bağdaştırıcısı (çok parçalı `text`
// alanı veya `.txt` dosyası) kullanılır. Rapor oluşturma portu bağlı değil: `/report` 503 döner.
import {
  KunyeCheckCreated,
  KunyeCheckTextLimits,
  KunyeCheckViewDto,
} from '@eda/contracts/api/kunye-checks';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { AppError } from '@eda/contracts/errors';
import type { Context, Hono } from 'hono';
import type { SurfaceEnv } from '../context/types.ts';
import type { RouteMeta } from '../routing/define-route.ts';
import type { RouteRegistry } from '../routing/route-registry.ts';
import { tenantActor } from './helpers.ts';

/** Geliştirme dilimi: kimlik zinciri ve census muafiyeti; yalnız development/test. */
const DEV_SLICE = { devSlice: true } as const;

import type { KunyeChecker } from '../services/kunye-check/kunye-check.ts';

const BASE_META: RouteMeta = {
  permission: 'research:use',
  tenant: 'none',
  allowVerification: 'pending',
  mfa: 'exempt',
  clientData: true,
  stepUp: false,
  idempotency: 'none',
  rateLimit: 'api',
  body: 'none',
  timeout: 'default',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISTANBUL_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' });
const MAX_TXT_BYTES = CONFIG_DEFAULTS['upload.maxMb'] * 1024 * 1024;

/** Kimlik (P04) gelene dek tek geliştirici kullanıcısı; iş sahipliği bu anahtarla. */
const DEV_OWNER = 'dev';

export type KunyeCheckRouteDeps = {
  checker: KunyeChecker;
  uuid: () => string;
  now: () => Date;
};

function invalid(
  path: string,
  issue: 'required' | 'invalid_type' | 'too_short' | 'too_long',
): never {
  throw new AppError('VALIDATION_FAILED', { fields: [{ path, issue }] });
}

async function textOf(req: Request): Promise<string> {
  const type = req.headers.get('content-type') ?? '';
  if (!type.startsWith('multipart/form-data')) {
    throw new AppError('FILE_TYPE_NOT_ALLOWED', { reason: 'kunye_check_type' });
  }
  const form = await req.formData();
  const file = form.get('file');
  const field = form.get('text');
  let text: string;
  if (file instanceof File) {
    if (file.type !== 'text/plain' && !/\.txt$/i.test(file.name)) {
      throw new AppError('FILE_TYPE_NOT_ALLOWED', { reason: 'kunye_check_type' });
    }
    if (file.size > MAX_TXT_BYTES) throw new AppError('FILE_TOO_LARGE');
    text = await file.text();
  } else if (typeof field === 'string') {
    text = field;
  } else {
    return invalid('body.text', 'required');
  }
  if (text.trim().length < KunyeCheckTextLimits.minChars) invalid('body.text', 'too_short');
  if (text.length > KunyeCheckTextLimits.maxChars) invalid('body.text', 'too_long');
  return text;
}

export function mountKunyeChecks(
  app: Hono<SurfaceEnv>,
  registry: RouteRegistry,
  deps: KunyeCheckRouteDeps,
  authed = false,
): void {
  // Kimlik zinciri kuruluysa oturum + büro kapısından geçer; kamu araçları `pending` kullanıcıya açıktır.
  const META: RouteMeta = authed
    ? { ...BASE_META, tenant: 'required', clientData: false }
    : BASE_META;
  const opts = authed ? undefined : DEV_SLICE;
  const ownerOf = (c: Context<SurfaceEnv>): string => (authed ? tenantActor(c).userId : DEV_OWNER);
  const base = '/api/v1/kunye-checks';
  const idempotency = new Map<string, string>();

  registry.add(
    'post',
    base,
    {
      ...META,
      // Kimlik zincirinde de başlık uçta denetlenir (bellek içi tekilleştirme); ara katman kapalı.
      idempotency: authed ? 'none' : 'required',
      clientData: authed,
      body: 'upload',
      timeout: 'upload',
    },
    opts,
  );
  app.post(base, async (c) => {
    const key = c.req.header('idempotency-key') ?? '';
    if (!UUID.test(key)) invalid('header.idempotency-key', 'required');
    const existing = idempotency.get(key);
    if (existing) return c.json(KunyeCheckCreated.parse({ checkId: existing }), 202);
    const text = await textOf(c.req.raw);
    const checkId = deps.uuid();
    idempotency.set(key, checkId);
    if (idempotency.size > 500) idempotency.delete(idempotency.keys().next().value ?? '');
    const now = deps.now();
    // Bugün Europe/Istanbul günüdür (025 §5.6 future_date).
    const today = ISTANBUL_DAY.format(now);
    deps.checker.start(checkId, ownerOf(c), text, today, deps.now);
    c.header('Cache-Control', 'no-store');
    return c.json(KunyeCheckCreated.parse({ checkId }), 202);
  });

  registry.add('get', `${base}/{checkId}`, { ...META, clientData: false }, opts);
  app.get(`${base}/:checkId`, (c) => {
    const id = c.req.param('checkId');
    const view = UUID.test(id) ? deps.checker.get(id, ownerOf(c)) : null;
    if (!view) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'kunye_check' });
    c.header('Cache-Control', 'no-store');
    return c.json(KunyeCheckViewDto.parse(view));
  });

  registry.add('get', `${base}/{checkId}/report`, { ...META, clientData: false }, opts);
  app.get(`${base}/:checkId/report`, () => {
    throw new AppError('INTERNAL_DEPENDENCY_UNAVAILABLE');
  });
}
