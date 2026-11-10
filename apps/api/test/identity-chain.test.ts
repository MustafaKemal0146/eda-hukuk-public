// @tk TK-03 TK-04
// Kimlik zinciri birim testleri (ağsız; sahte kimlik ve sahte Valkey):
// KK-P04a-8 (KK-042-14): route census — bilinmeyen izin, liste dışı `public` ve kurulu olmayan ara
// katmana (`mfaGate`, `stepUp`, `idempotency`) bağımlı rota kaydı başlatma hatasıdır.
// KK-P04a-5 (KK-042-5 alt kümesi): `verificationGate` 042 §3.2 tablosu.
// KK-P04a-3 (KK-042-3) ara katman kısmı: oturumsuz 401, süresi dolmuş 401, mutlak süre iptali.
// KK-P04a-2 (KK-042-2): izin listesi dışı `/api/auth/*` yolları 404 ve Better Auth'a ulaşmaz.
// KK-P04a-9 (KK-042-17) birim kısmı: kademeli bekleme formülü, Valkey yokken `auth-ip` 503.
import type { VerificationStatus } from '@eda/contracts/enums';
import { ApiErrorEnvelope } from '@eda/contracts/errors';
import { isRoutePermission } from '@eda/contracts/permissions';
import { createLogger } from '@eda/observability/logger';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { assertRoutesRegistered, createAppSurface, type IdentitySurfaceDeps } from '../src/app.ts';
import {
  AUTH_DISABLED_PATHS,
  AUTH_PATH_ALLOWLIST,
  isAllowedAuthRequest,
} from '../src/auth/allowlist.ts';
import { SESSION_COOKIE } from '../src/auth/cookies.ts';
import type { ResolvedSession } from '../src/auth/index.ts';
import type { SurfaceEnv } from '../src/context/types.ts';
import { errorHandler, notFoundHandler } from '../src/errors/error-handler.ts';
import { createReadiness } from '../src/health/ready.ts';
import { originCheck } from '../src/middleware/origin-check.ts';
import { backoffDelaySec, ipPrefix, RateLimiter } from '../src/middleware/rate-limit.ts';
import { requestId } from '../src/middleware/request-id.ts';
import { routeMeta } from '../src/middleware/route-meta.ts';
import { session } from '../src/middleware/session.ts';
import { gateDecision, verificationGate } from '../src/middleware/verification-gate.ts';
import { ME_META } from '../src/routes/me/index.ts';
import type { RouteMeta } from '../src/routing/define-route.ts';
import { RouteDefinitionError } from '../src/routing/define-route.ts';
import { INSTALLED_GATES, RouteRegistry } from '../src/routing/route-registry.ts';

const APP_URL = 'https://app.ornek.test';
const USER = '0198d2a4-0000-7000-8000-0000000000a1';
const silent = { write: () => undefined };
const logger = createLogger({ service: 'eda-api-test', destination: silent });

/** GCRA betiğini çağırmayan sahte Valkey: her istek serbest veya her komut hata verir. */
function fakeRedis(mode: 'ok' | 'down'): Redis {
  const fail = async () => {
    throw new Error('valkey yok');
  };
  return {
    defineCommand: () => undefined,
    edaGcra: mode === 'ok' ? async () => [1, 0] : fail,
    hgetall: mode === 'ok' ? async () => ({}) : fail,
    del: mode === 'ok' ? async () => 1 : fail,
    multi: () => ({
      hincrby() {
        return this;
      },
      hset() {
        return this;
      },
      pexpire() {
        return this;
      },
      exec: mode === 'ok' ? async () => [] : fail,
    }),
  } as unknown as Redis;
}

function resolved(
  over: {
    status?: VerificationStatus;
    createdAt?: Date;
    role?: 'user' | 'support';
    banned?: boolean;
  } = {},
): ResolvedSession {
  const createdAt = over.createdAt ?? new Date();
  return {
    session: {
      id: 'sess-1',
      userId: USER,
      token: 'tok-1',
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 12 * 3_600_000),
      mfaLevel: 'none',
      stepUpAt: createdAt,
      activeOrganizationId: null,
      surface: 'app',
    },
    user: {
      id: USER,
      platformRole: over.role ?? 'user',
      verificationStatus: over.status ?? 'pending_verification',
      banned: over.banned ?? false,
    },
    setCookie: [],
  };
}

interface FakeIdentity {
  current: ResolvedSession | null;
  handled: string[];
  revoked: string[];
}

function identityDeps(fake: FakeIdentity, redisMode: 'ok' | 'down' = 'ok'): IdentitySurfaceDeps {
  return {
    appUrl: APP_URL,
    identity: {
      handle: async (req) => {
        fake.handled.push(new URL(req.url).pathname);
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      },
      getSession: async () => fake.current,
      revokeSession: async (token) => {
        fake.revoked.push(token);
      },
      assertCanRemoveFactor: async () => undefined,
      stepUp: async () => {
        throw new Error('beklenmeyen stepUp');
      },
      listSessions: async () => [],
      revokeSessionById: async () => false,
      revokeOtherSessions: async () => 0,
    },
    rate: new RateLimiter({ redis: fakeRedis(redisMode), hmacKey: Buffer.alloc(32, 1) }),
    tenantDb: {
      withTenant: async () => {
        throw new Error('beklenmeyen withTenant');
      },
      withUserScope: async () => {
        throw new Error('beklenmeyen withUserScope');
      },
    },
    idempotency: {
      claim: async () => true,
      get: async () => null,
      put: async () => undefined,
      del: async () => undefined,
    },
    org: {} as never,
    documents: {} as never,
    calendar: {} as never,
    cases: {} as never,
    files: {} as never,
    notificationPreferences: {} as never,
    notificationInbox: {} as never,
    audit: async () => undefined,
    aiKeys: {} as never,
    me: {
      me: async () => ({}) as never,
      applyLawyer: async () => ({}) as never,
    },
  };
}

function surface(fake: FakeIdentity, redisMode: 'ok' | 'down' = 'ok') {
  const ready = createReadiness({
    probes: [{ name: 'postgres', hard: true, run: async () => true }],
    cacheMs: 0,
    version: 'test',
    state: { draining: false },
  });
  return createAppSurface({
    surface: 'app',
    logger,
    state: { draining: false },
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 65_536,
    ready,
    identity: identityDeps(fake, redisMode),
  });
}

const meta = (over: Partial<RouteMeta>): RouteMeta => ({ ...ME_META, tenant: 'none', ...over });

async function errorOf(res: Response) {
  return ApiErrorEnvelope.parse(await res.json()).error;
}

describe('KK-P04a-8 (KK-042-14): route census ve INSTALLED_GATES', () => {
  it('bilinmeyen izin adı kayıtta reddedilir; self ve kayıtlı izin kabul edilir', () => {
    const r = new RouteRegistry();
    expect(() => r.add('get', '/api/v1/a', meta({ permission: 'chat.use' }))).toThrow(
      RouteDefinitionError,
    );
    r.add('get', '/api/v1/b', meta({ permission: 'self' }));
    r.add('get', '/api/v1/c', meta({ permission: 'chat:use', tenant: 'required' }));
    expect(r.list()).toHaveLength(2);
  });

  it('public yalnız 040 §5.9 listesindeki rotada', () => {
    const r = new RouteRegistry();
    expect(() => r.add('get', '/api/v1/serbest', meta({ permission: 'public' }))).toThrow(/public/);
    r.add('get', '/api/v1/billing/plans', meta({ permission: 'public' }));
  });

  it('kurulu olmayan ara katmana bağımlı rota açılışta reddedilir (mfaGate, stepUp, idempotency)', () => {
    // P04a kümesi (P04b ara katmanları yokken) fail-closed davranışı korunur.
    const r = new RouteRegistry(
      INSTALLED_GATES.filter((g) => g !== 'mfaGate' && g !== 'stepUp' && g !== 'idempotency'),
    );
    expect(() => r.add('get', '/api/v1/m', meta({ mfa: 'policy' }))).toThrow(/mfaGate/);
    expect(() =>
      r.add('post', '/api/v1/s', meta({ permission: 'org:member_manage', stepUp: true })),
    ).toThrow(/stepUp/);
    expect(() => r.add('post', '/api/v1/i', meta({ idempotency: 'required' }))).toThrow(
      /idempotency/,
    );
    // Ara katman kurulduğunda (P04b) aynı rota kabul edilir.
    const later = new RouteRegistry();
    later.add('get', '/api/v1/m', meta({ mfa: 'policy' }));
  });

  it('geliştirme dilimi rotası census dışıdır ve kimlik zincirine girmez (AS-0260)', () => {
    const r = new RouteRegistry();
    r.add('post', '/api/v1/conversations', meta({ permission: 'chat:use', mfa: 'policy' }), {
      devSlice: true,
    });
    expect(r.find('POST', '/api/v1/conversations')?.devSlice).toBe(true);
  });

  it('kimlik yüzeyindeki her kayıtlı rota izni PERMISSIONS kaydında veya self/public', () => {
    const { registry } = surface({ current: null, handled: [], revoked: [] });
    const routes = registry.list().filter((x) => !x.devSlice);
    expect(routes.map((x) => `${x.method} ${x.path}`).sort()).toEqual([
      'DELETE /api/v1/ai-keys/org',
      'DELETE /api/v1/ai-keys/own',
      'DELETE /api/v1/calendar/events/{eventId}',
      'DELETE /api/v1/documents/{documentId}',
      'DELETE /api/v1/files/{fileId}',
      'DELETE /api/v1/me/sessions/{sessionId}',
      'DELETE /api/v1/org/invitations/{invitationId}',
      'DELETE /api/v1/org/members/{memberId}',
      'GET /api/v1/ai-keys',
      'GET /api/v1/calendar/events',
      'GET /api/v1/cases',
      'GET /api/v1/cases/{caseId}',
      'GET /api/v1/cases/{caseId}/files',
      'GET /api/v1/documents',
      'GET /api/v1/documents/{documentId}',
      'GET /api/v1/documents/{documentId}/diff',
      'GET /api/v1/documents/{documentId}/versions',
      'GET /api/v1/documents/{documentId}/versions/{versionId}',
      'GET /api/v1/files/{fileId}',
      'GET /api/v1/files/{fileId}/content',
      'GET /api/v1/me',
      'GET /api/v1/me/sessions',
      'GET /api/v1/notifications',
      'GET /api/v1/notifications/preferences',
      'GET /api/v1/org',
      'GET /api/v1/org/invitations',
      'GET /api/v1/org/members',
      'GET /api/v1/templates',
      'PATCH /api/v1/calendar/events/{eventId}',
      'PATCH /api/v1/cases/{caseId}',
      'PATCH /api/v1/documents/{documentId}',
      'PATCH /api/v1/org/members/{memberId}',
      'POST /api/v1/calendar/events',
      'POST /api/v1/cases',
      'POST /api/v1/documents',
      'POST /api/v1/documents/{documentId}/versions',
      'POST /api/v1/documents/{documentId}/versions/{versionId}/restore',
      'POST /api/v1/files',
      'POST /api/v1/files/{fileId}/download-token',
      'POST /api/v1/me/lawyer-application',
      'POST /api/v1/me/sessions/revoke-others',
      'POST /api/v1/me/step-up',
      'POST /api/v1/notifications/read-all',
      'POST /api/v1/notifications/{notificationId}/read',
      'POST /api/v1/org/invitations',
      'PUT /api/v1/ai-keys/org',
      'PUT /api/v1/ai-keys/own',
      'PUT /api/v1/ai-keys/source',
      'PUT /api/v1/documents/{documentId}/draft',
      'PUT /api/v1/notifications/preferences',
    ]);
    for (const x of routes) expect(isRoutePermission(x.meta.permission)).toBe(true);
  });

  it('kayıt defterinde olmayan /api/v1 rotası açılış hatasıdır (fail-closed)', () => {
    const r = new RouteRegistry();
    expect(() => assertRoutesRegistered([{ method: 'GET', path: '/api/v1/gizli' }], r)).toThrow(
      /kayıt defterinde yok/,
    );
  });
});

describe('KK-P04a-5 (KK-042-5): verificationGate 042 §3.2 tablosu', () => {
  const statuses: VerificationStatus[] = [
    'verified',
    'pending_verification',
    'rejected',
    'suspended',
  ];
  const expected: Record<RouteMeta['allowVerification'], (string | null)[]> = {
    verified: [null, 'AUTH_PENDING_VERIFICATION', 'AUTH_FORBIDDEN', 'AUTH_SUSPENDED'],
    pending: [null, null, 'AUTH_FORBIDDEN', 'AUTH_SUSPENDED'],
    any: [null, null, null, 'AUTH_SUSPENDED'],
  };

  it('karar tablosu birebir', () => {
    for (const [allow, codes] of Object.entries(expected)) {
      statuses.forEach((status, i) => {
        const err = gateDecision(
          allow as RouteMeta['allowVerification'],
          status,
          'GET /api/v1/deneme',
        );
        expect(err?.code ?? null, `${allow} × ${status}`).toBe(codes[i]);
      });
    }
    expect(gateDecision('verified', 'rejected', 'x')?.reason).toBe('verification_rejected');
  });

  it('askıdaki kullanıcı yalnız GET /me (any) ucuna girer', () => {
    expect(gateDecision('any', 'suspended', 'GET /api/v1/me')).toBeNull();
    expect(gateDecision('any', 'suspended', 'POST /api/v1/me/lawyer-application')?.code).toBe(
      'AUTH_SUSPENDED',
    );
  });

  it('zincir üzerinden: pending kullanıcı verified rotada 403, pending/any rotada 200', async () => {
    const fake: FakeIdentity = { current: resolved(), handled: [], revoked: [] };
    const registry = new RouteRegistry();
    const app = new Hono<SurfaceEnv>();
    app.use('*', requestId());
    app.use('/api/v1/*', routeMeta(registry));
    app.use('/api/v1/*', session(identityDeps(fake).identity, logger));
    app.use('/api/v1/*', verificationGate());
    for (const v of ['verified', 'pending', 'any'] as const) {
      registry.add('get', `/api/v1/t/${v}`, meta({ allowVerification: v }));
      app.get(`/api/v1/t/${v}`, (c) => c.json({ ok: true }));
    }
    app.onError(errorHandler({ logger, surface: 'app' }));
    app.notFound(notFoundHandler());
    const call = async (v: string) => app.request(`/api/v1/t/${v}`);
    expect((await call('pending')).status).toBe(200);
    expect((await call('any')).status).toBe(200);
    const denied = await call('verified');
    expect(denied.status).toBe(403);
    expect((await errorOf(denied)).code).toBe('AUTH_PENDING_VERIFICATION');
    fake.current = resolved({ status: 'rejected' });
    expect((await call('pending')).status).toBe(403);
    expect((await call('any')).status).toBe(200);
    fake.current = resolved({ status: 'verified' });
    expect((await call('verified')).status).toBe(200);
  });
});

describe('KK-P04a-3 (KK-042-3): session ara katmanı', () => {
  it('çerez yoksa 401 AUTH_UNAUTHENTICATED; çerez var oturum yoksa 401 AUTH_SESSION_EXPIRED', async () => {
    const fake: FakeIdentity = { current: null, handled: [], revoked: [] };
    const { app } = surface(fake);
    const none = await app.request('/api/v1/me');
    expect(none.status).toBe(401);
    expect((await errorOf(none)).code).toBe('AUTH_UNAUTHENTICATED');
    const stale = await app.request('/api/v1/me', {
      headers: { cookie: `${SESSION_COOKIE}=eski.imza` },
    });
    expect(stale.status).toBe(401);
    expect((await errorOf(stale)).code).toBe('AUTH_SESSION_EXPIRED');
  });

  it('mutlak süre (30 gün) dolan oturum iptal edilir ve 401 absolute_timeout', async () => {
    const fake: FakeIdentity = {
      current: resolved({ createdAt: new Date(Date.now() - 30 * 86_400_000 - 1000) }),
      handled: [],
      revoked: [],
    };
    const res = await surface(fake).app.request('/api/v1/me');
    expect(res.status).toBe(401);
    const err = await errorOf(res);
    expect(err.code).toBe('AUTH_SESSION_EXPIRED');
    expect(err.reason).toBe('absolute_timeout');
    expect(fake.revoked).toEqual(['tok-1']);
  });

  it('personel oturumu uygulama yüzeyinde 403 staff_on_app_surface; yasaklı 403 AUTH_SUSPENDED', async () => {
    const fake: FakeIdentity = { current: resolved({ role: 'support' }), handled: [], revoked: [] };
    const { app } = surface(fake);
    const staff = await app.request('/api/v1/me');
    expect(staff.status).toBe(403);
    expect((await errorOf(staff)).reason).toBe('staff_on_app_surface');
    fake.current = resolved({ banned: true });
    const banned = await app.request('/api/v1/me');
    expect((await errorOf(banned)).code).toBe('AUTH_SUSPENDED');
  });
});

describe('KK-P04a-2 (KK-042-2): /api/auth/* izin listesi', () => {
  const blocked: [string, string][] = [
    ['POST', '/api/auth/admin/list-users'],
    ['POST', '/api/auth/admin/set-role'],
    ['POST', '/api/auth/admin/impersonate-user'],
    ['POST', '/api/auth/change-email'],
    ['POST', '/api/auth/delete-user'],
    ['POST', '/api/auth/organization/create'],
    ['POST', '/api/auth/sign-in/social'],
    ['POST', '/api/auth/update-user'],
    ['GET', '/api/auth/reset-password/abc'],
    ['GET', '/api/auth/sign-in/email'],
    ['POST', '/api/auth/verify-email'],
    ['GET', '/api/auth/ok'],
  ];

  it('liste dışı yol veya yöntem 404 ve Better Auth işleyicisine ulaşmaz', async () => {
    const fake: FakeIdentity = { current: null, handled: [], revoked: [] };
    const { app } = surface(fake);
    for (const [method, path] of blocked) {
      const res = await app.request(path, {
        method,
        headers: { origin: APP_URL, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}),
      });
      expect(res.status, `${method} ${path}`).toBe(404);
      expect((await errorOf(res)).code).toBe('VALIDATION_ROUTE_NOT_FOUND');
    }
    expect(fake.handled).toEqual([]);
    const ok = await app.request('/api/auth/get-session');
    expect(ok.status).toBe(200);
    expect(fake.handled).toEqual(['/api/auth/get-session']);
  });

  it('izin listesi ile kapalı yollar kesişmez; sondaki eğik çizgi aynı yoldur', () => {
    for (const p of AUTH_DISABLED_PATHS) expect(AUTH_PATH_ALLOWLIST[p]).toBeUndefined();
    expect(isAllowedAuthRequest('POST', '/api/auth/sign-in/email/')).toBe(true);
    expect(isAllowedAuthRequest('POST', '/api/authx/sign-in/email')).toBe(false);
  });
});

describe('040 §5.7: Origin denetimi', () => {
  const app = new Hono<SurfaceEnv>();
  app.use('*', requestId());
  app.use('*', originCheck(APP_URL, logger));
  app.post('/api/x', (c) => c.json({ ok: true }));
  app.get('/api/x', (c) => c.json({ ok: true }));
  app.onError(errorHandler({ logger, surface: 'app' }));

  it('durum değiştiren istekte yabancı veya eksik Origin 403 origin_mismatch', async () => {
    const foreign = await app.request('/api/x', {
      method: 'POST',
      headers: { origin: 'https://kotu.ornek.test' },
    });
    expect(foreign.status).toBe(403);
    expect((await errorOf(foreign)).reason).toBe('origin_mismatch');
    expect((await app.request('/api/x', { method: 'POST' })).status).toBe(403);
  });

  it('eşit Origin veya Sec-Fetch-Site: same-origin geçer; GET denetlenmez', async () => {
    expect(
      (await app.request('/api/x', { method: 'POST', headers: { origin: APP_URL } })).status,
    ).toBe(200);
    expect(
      (
        await app.request('/api/x', {
          method: 'POST',
          headers: { 'sec-fetch-site': 'same-origin' },
        })
      ).status,
    ).toBe(200);
    expect((await app.request('/api/x')).status).toBe(200);
  });
});

describe('KK-P04a-9 (KK-042-17): hız sınırı birimleri', () => {
  it('kademeli bekleme min(base × 2^(n − eşik), max): eşik altı 0, sonra artan', () => {
    expect(backoffDelaySec(4)).toBe(0);
    expect(backoffDelaySec(5)).toBe(5);
    expect(backoffDelaySec(6)).toBe(10);
    expect(backoffDelaySec(7)).toBe(20);
    expect(backoffDelaySec(50)).toBe(900);
  });

  it('hesap+IP anahtarı IPv4 /24 ve IPv6 /64 önekiyle; e-posta düz yazılmaz', () => {
    const rate = new RateLimiter({ redis: fakeRedis('ok'), hmacKey: Buffer.alloc(32, 1) });
    expect(ipPrefix('203.0.113.77')).toBe('203.0.113.0');
    expect(ipPrefix('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
    const key = rate.accountKey('avukat@ornek.test', '203.0.113.77');
    expect(key).toMatch(/^eda:rl:auth-account:[A-Za-z0-9_-]{32}:203\.0\.113\.0$/);
    expect(key).not.toContain('ornek');
  });

  it('Valkey yokken auth-ip ve hesap sayacı fail-closed 503; api-user süreç içi yedekle sınırlı', async () => {
    const onFallback = vi.fn();
    const rate = new RateLimiter({
      redis: fakeRedis('down'),
      hmacKey: Buffer.alloc(32, 1),
      onFallback,
    });
    await expect(rate.check('auth-ip', '203.0.113.1', 10, 60_000)).rejects.toMatchObject({
      code: 'INTERNAL_DEPENDENCY_UNAVAILABLE',
    });
    await expect(rate.backoffRemainingSec('a@ornek.test', '203.0.113.1')).rejects.toMatchObject({
      code: 'INTERNAL_DEPENDENCY_UNAVAILABLE',
    });
    const results: boolean[] = [];
    for (let i = 0; i < 3; i++)
      results.push((await rate.check('api-user', USER, 2, 60_000)).allowed);
    expect(results).toEqual([true, true, false]);
    expect(onFallback).toHaveBeenCalled();
  });

  it('Valkey yokken kimlik ucu 503 döner ve Better Auth çağrılmaz', async () => {
    const fake: FakeIdentity = { current: null, handled: [], revoked: [] };
    const { app } = surface(fake, 'down');
    const res = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        origin: APP_URL,
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({ email: 'a@ornek.test', password: 'x' }),
    });
    expect(res.status).toBe(503);
    expect((await errorOf(res)).code).toBe('INTERNAL_DEPENDENCY_UNAVAILABLE');
    expect(fake.handled).toEqual([]);
  });
});
