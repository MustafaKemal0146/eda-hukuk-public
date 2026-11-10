// @tk TK-03
// KK-P01b-6: route census — meta verisiz rota tanım ve kayıt anında reddedilir.
import { z } from '@hono/zod-openapi';
import { describe, expect, it } from 'vitest';
import { defineRoute, RouteDefinitionError } from '../src/routing/define-route.ts';
import { RouteRegistry } from '../src/routing/route-registry.ts';

const responses = {
  200: { description: 'ok', content: { 'application/json': { schema: z.object({}) } } },
};

describe('KK-P01b-6: defineRoute ve RouteRegistry', () => {
  it('yetki meta verisi olmayan rota tanımı hata verir', () => {
    expect(() =>
      defineRoute({ method: 'get', path: '/api/v1/deneme', responses, meta: {} as never }),
    ).toThrow(RouteDefinitionError);
  });

  it('meta varsayılanları 040 §4 tablosuyla doldurulur', () => {
    const route = defineRoute({
      method: 'get',
      path: '/api/v1/deneme',
      responses,
      meta: { permission: 'self' },
    });
    expect(route.meta).toEqual({
      permission: 'self',
      tenant: 'required',
      allowVerification: 'verified',
      mfa: 'policy',
      clientData: false,
      stepUp: false,
      idempotency: 'none',
      rateLimit: 'api',
      body: 'none',
      timeout: 'default',
    });
  });

  it('aynı metot + yol iki kez kaydedilemez; meta verisiz kayıt reddedilir', () => {
    const registry = new RouteRegistry();
    // P04a: MFA kapısı kurulana dek (P04b) yalnız `mfa: exempt` rota kaydedilebilir (KK-P04a-8).
    const route = defineRoute({
      method: 'post',
      path: '/api/v1/deneme',
      responses,
      meta: { permission: 'self', mfa: 'exempt' },
    });
    registry.add('post', route.path, route.meta);
    expect(() => registry.add('POST', route.path, route.meta)).toThrow(/iki kez/);
    expect(() => registry.add('get', '/api/v1/baska', undefined)).toThrow(/meta/);
  });
});
