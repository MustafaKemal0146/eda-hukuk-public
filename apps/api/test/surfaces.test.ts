// @tk TK-03
// KK-P01b-4: yüzey ayrımı, başlıklar, X-Request-Id, no-store ve hata zarfı (KK-040-1, -4, -5 bölümleri).
import { ApiErrorEnvelope } from '@eda/contracts/errors';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { createAdminSurface } from '../src/admin-app.ts';
import { createAppSurface } from '../src/app.ts';
import type { RuntimeState, SurfaceDeps } from '../src/context/types.ts';
import { createReadiness } from '../src/health/ready.ts';

const silent = { write: () => undefined };

function deps(state: RuntimeState = { draining: false }, maintenance = false): SurfaceDeps {
  return {
    surface: 'app',
    logger: createLogger({ service: 'eda-api-test', destination: silent }),
    state,
    maintenanceMode: () => maintenance,
    jsonBodyMaxBytes: 1024,
  };
}

function appSurface(state?: RuntimeState, maintenance = false) {
  const d = deps(state, maintenance);
  const ready = createReadiness({
    probes: [{ name: 'postgres', hard: true, run: async () => true }],
    cacheMs: 0,
    version: 'test',
    state: d.state,
  });
  return createAppSurface({ ...d, ready }).app;
}

async function envelope(res: Response) {
  return ApiErrorEnvelope.parse(await res.json()).error;
}

describe('KK-P01b-4: uygulama yüzeyi :8000', () => {
  it('/api/v1/admin/* kayıtsızdır: 404 VALIDATION_ROUTE_NOT_FOUND + zarf', async () => {
    const res = await appSurface().request('/api/v1/admin/x');
    expect(res.status).toBe(404);
    const err = await envelope(res);
    expect(err.code).toBe('VALIDATION_ROUTE_NOT_FOUND');
    expect(err.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('her /api/* yanıtında Cache-Control: no-store ve nosniff', async () => {
    const res = await appSurface().request('/api/v1/yok');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('geçerli X-Request-Id korunur, geçersizi yerine uuidv7 üretilir', async () => {
    const ok = await appSurface().request('/health', { headers: { 'x-request-id': 'abc-12345' } });
    expect(ok.headers.get('x-request-id')).toBe('abc-12345');
    const bad = await appSurface().request('/health', {
      headers: { 'x-request-id': 'gecersiz deger;!' },
    });
    expect(bad.headers.get('x-request-id')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('/health zarfsız {status: ok}', async () => {
    const res = await appSurface().request('/health');
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('json dışı içerik türü 415, sınır aşımı 413', async () => {
    const app = appSurface();
    const media = await app.request('/api/v1/x', {
      method: 'POST',
      body: 'a',
      headers: { 'content-type': 'text/plain' },
    });
    expect(media.status).toBe(415);
    expect((await envelope(media)).code).toBe('VALIDATION_UNSUPPORTED_MEDIA_TYPE');
    const big = await app.request('/api/v1/x', {
      method: 'POST',
      body: JSON.stringify({ a: 'x'.repeat(2048) }),
      headers: { 'content-type': 'application/json' },
    });
    expect(big.status).toBe(413);
    expect((await envelope(big)).code).toBe('VALIDATION_PAYLOAD_TOO_LARGE');
  });

  it('gövdesiz DELETE içerik türü hatası vermez (silme uçları)', async () => {
    const res = await appSurface().request('/api/v1/x', { method: 'DELETE' });
    expect(res.status).not.toBe(415);
  });

  it('bakım modunda /api/v1/* 503 + Retry-After: 30; GET /api/v1/me istisna', async () => {
    const app = appSurface(undefined, true);
    const res = await app.request('/api/v1/cases');
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect((await envelope(res)).code).toBe('INTERNAL_MAINTENANCE');
    expect((await app.request('/api/v1/me')).status).toBe(404);
  });
});

describe('KK-P01b-4: admin yüzeyi :8010', () => {
  const admin = () => createAdminSurface({ ...deps(), surface: 'admin' });

  it('/health 200; /ready, /metrics ve uygulama rotaları 404', async () => {
    expect((await admin().request('/health')).status).toBe(200);
    for (const path of ['/ready', '/metrics', '/api/v1/cases']) {
      expect((await admin().request(path)).status).toBe(404);
    }
  });
});

describe('KK-P01b-5: drenaj', () => {
  it('drenajda /ready 503 ve Connection: close', async () => {
    const state = { draining: false };
    const app = appSurface(state);
    expect((await app.request('/ready')).status).toBe(200);
    state.draining = true;
    const res = await app.request('/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: 'fail', draining: true });
    expect((await app.request('/api/v1/x')).headers.get('connection')).toBe('close');
  });
});
