// P04b birim testleri (ağsız):
//  KK-P04b-6  (KK-042-10) MFA politika matrisi (saf fonksiyon) ve `mfaGate` / `requireMfaForClientData`.
//  KK-P04b-8  (KK-042-12) step-up penceresi ve `stepUp` ara katmanı.
//  KK-P04b-10 (KK-042-14) INSTALLED_GATES tam; census: step-up ↔ izin tablosu, clientData ↔ 042 §5.1,
//                          idempotent rota yanıt şeması serbest metin taşımaz.
//  KK-P04b-5  (KK-042-2)  yol izin listesi: büro yönetimi, get-totp-uri ve admin/* kapalı.
import { InvitationCreatedDto, InvitationDto } from '@eda/contracts/api/org';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { ApiErrorEnvelope } from '@eda/contracts/errors';
import { PERMISSIONS } from '@eda/contracts/permissions';
import { createLogger } from '@eda/observability/logger';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { isAllowedAuthRequest, STEP_UP_AUTH_PATHS } from '../src/auth/allowlist.ts';
import { CLIENT_DATA_ROUTES, mfaAlwaysRequired, mfaRequired } from '../src/auth/mfa-policy.ts';
import { allowedStepUpMethods, stepUpValid } from '../src/auth/step-up.ts';
import type { SessionVar, SurfaceEnv, TenantVar } from '../src/context/types.ts';
import { errorHandler } from '../src/errors/error-handler.ts';
import { canonicalJson } from '../src/middleware/idempotency.ts';
import { mfaGate, requireMfaForClientData } from '../src/middleware/mfa-gate.ts';
import { stepUp } from '../src/middleware/step-up.ts';
import { ME_META } from '../src/routes/me/index.ts';
import type { RouteMeta } from '../src/routing/define-route.ts';
import {
  freeTextFields,
  INSTALLED_GATES,
  RouteRegistry,
  stepUpExpected,
} from '../src/routing/route-registry.ts';

const logger = createLogger({ service: 'eda-api-test', level: 'fatal' });

const session = (over: Partial<SessionVar> = {}): SessionVar => ({
  id: '00000000-0000-7000-8000-000000000001',
  userId: '00000000-0000-7000-8000-000000000002',
  createdAt: new Date(),
  mfaLevel: 'none',
  stepUpAt: new Date(),
  activeOrganizationId: '00000000-0000-7000-8000-000000000003',
  ...over,
});
const tenant = (over: Partial<TenantVar> = {}): TenantVar => ({
  orgId: '00000000-0000-7000-8000-000000000003',
  userId: '00000000-0000-7000-8000-000000000002',
  memberRole: 'owner',
  orgKind: 'firm',
  mfaRequiredAll: false,
  ...over,
});
const meta = (over: Partial<RouteMeta>): RouteMeta => ({ ...ME_META, mfa: 'policy', ...over });

function gateApp(m: RouteMeta, s: SessionVar, t: TenantVar | null) {
  const app = new Hono<SurfaceEnv>();
  app.use('*', async (c, next) => {
    c.set('requestId', '00000000-0000-7000-8000-00000000000a');
    c.set('routeMeta', m);
    c.set('session', s);
    c.set('tenant', t);
    await next();
  });
  app.use('*', mfaGate());
  app.use('*', stepUp());
  app.get('/x', (c) => {
    requireMfaForClientData(c);
    return c.json({ ok: true });
  });
  app.get('/y', (c) => c.json({ ok: true }));
  app.onError(errorHandler({ logger, surface: 'app' }));
  return app;
}

describe('KK-P04b-6 (KK-042-10): MFA politika matrisi', () => {
  it('firm owner/admin her zaman; individual owner/admin yalnız clientData; mfa_required_all tüm roller; diğerleri hayır', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(
        mfaRequired({ memberRole: role, orgKind: 'firm', mfaRequiredAll: false }, false),
      ).toEqual({
        required: true,
        reason: 'mfa_required_role',
      });
      expect(
        mfaRequired({ memberRole: role, orgKind: 'individual', mfaRequiredAll: false }, false),
      ).toEqual({ required: false, reason: null });
      expect(
        mfaRequired({ memberRole: role, orgKind: 'individual', mfaRequiredAll: false }, true),
      ).toEqual({ required: true, reason: 'mfa_required_client_data' });
    }
    for (const role of ['senior_lawyer', 'lawyer', 'trainee', 'assistant'] as const) {
      expect(
        mfaRequired({ memberRole: role, orgKind: 'firm', mfaRequiredAll: false }, true),
      ).toEqual({
        required: false,
        reason: null,
      });
      expect(
        mfaRequired({ memberRole: role, orgKind: 'firm', mfaRequiredAll: true }, false),
      ).toEqual({
        required: true,
        reason: 'mfa_required_org',
      });
    }
    expect(mfaRequired(null, true)).toEqual({ required: false, reason: null });
    expect(
      mfaAlwaysRequired([{ memberRole: 'owner', orgKind: 'individual', mfaRequiredAll: false }]),
    ).toBe(false);
    expect(
      mfaAlwaysRequired([
        { memberRole: 'owner', orgKind: 'individual', mfaRequiredAll: false },
        { memberRole: 'lawyer', orgKind: 'firm', mfaRequiredAll: true },
      ]),
    ).toBe(true);
  });

  it("mfaGate: policy uçta MFA'sız firm owner 403, exempt geçer, MFA düzeyli oturum geçer; tek kişilik büro sahibi clientData anında 403", async () => {
    const denied = await gateApp(meta({}), session(), tenant()).request('/y');
    expect(denied.status).toBe(403);
    const body = ApiErrorEnvelope.parse(await denied.json()).error;
    expect(body).toMatchObject({ code: 'AUTH_MFA_REQUIRED', reason: 'mfa_required_role' });
    expect(body.actions).toEqual(['enroll_totp', 'enroll_passkey']);
    expect((await gateApp(meta({ mfa: 'exempt' }), session(), tenant()).request('/y')).status).toBe(
      200,
    );
    expect(
      (await gateApp(meta({}), session({ mfaLevel: 'totp' }), tenant()).request('/y')).status,
    ).toBe(200);
    const solo = tenant({ orgKind: 'individual' });
    expect((await gateApp(meta({}), session(), solo).request('/y')).status).toBe(200);
    const cd = await gateApp(meta({ clientData: true }), session(), solo).request('/y');
    expect(ApiErrorEnvelope.parse(await cd.json()).error.reason).toBe('mfa_required_client_data');
    const helper = await gateApp(meta({ mfa: 'exempt' }), session(), solo).request('/x');
    expect(helper.status).toBe(403);
    expect(
      (await gateApp(meta({ mfa: 'exempt' }), session({ mfaLevel: 'passkey' }), solo).request('/x'))
        .status,
    ).toBe(200);
  });
});

describe('KK-P04b-8 (KK-042-12): step-up penceresi', () => {
  it('pencere içi geçer, dışı 403 AUTH_STEP_UP_REQUIRED; yöntem MFA durumuna göre', async () => {
    const w = CONFIG_DEFAULTS['auth.stepUpWindowMin'] * 60_000;
    const now = Date.now();
    expect(stepUpValid(new Date(now - w + 1000), now)).toBe(true);
    expect(stepUpValid(new Date(now - w - 1000), now)).toBe(false);
    expect(stepUpValid(null, now)).toBe(false);
    const m = meta({ mfa: 'exempt', stepUp: true });
    const old = session({ stepUpAt: new Date(now - w - 1000) });
    const r = await gateApp(m, old, tenant()).request('/y');
    expect(r.status).toBe(403);
    const e = ApiErrorEnvelope.parse(await r.json()).error;
    expect(e.code).toBe('AUTH_STEP_UP_REQUIRED');
    expect(e.actions).toEqual(['step_up']);
    expect((await gateApp(m, session(), tenant()).request('/y')).status).toBe(200);
    expect(allowedStepUpMethods({ totp: false, passkeys: 0 })).toEqual(['password']);
    expect(allowedStepUpMethods({ totp: true, passkeys: 0 })).toEqual(['totp']);
    expect(allowedStepUpMethods({ totp: true, passkeys: 2 })).toEqual(['passkey', 'totp']);
    // Y-1: passkey EKLEME yolları da step-up ister (çalınmış çerezle kalıcı arka kapı eklenemez).
    expect([...STEP_UP_AUTH_PATHS].sort()).toEqual([
      '/change-password',
      '/passkey/delete-passkey',
      '/passkey/generate-register-options',
      '/passkey/verify-registration',
      '/two-factor/disable',
      '/two-factor/generate-backup-codes',
    ]);
  });
});

describe('KK-P04b-10 (KK-042-14 devamı): kurulu kapılar ve route census', () => {
  it('INSTALLED_GATES mfaGate, stepUp, idempotency içerir; bunlara bağımlı rota açılır', () => {
    for (const g of ['mfaGate', 'stepUp', 'idempotency'] as const) {
      expect(INSTALLED_GATES).toContain(g);
    }
    const r = new RouteRegistry();
    r.add('get', '/api/v1/org/members', {
      ...meta({}),
      permission: 'org:member_read',
      tenant: 'required',
    });
    r.add('patch', '/api/v1/org/members/{memberId}', {
      ...meta({}),
      permission: 'org:member_manage',
      stepUp: true,
    });
    r.add(
      'post',
      '/api/v1/org/invitations',
      { ...meta({}), permission: 'org:member_invite', idempotency: 'required' },
      { response: InvitationCreatedDto },
    );
    expect(r.list()).toHaveLength(3);
  });

  it('step-up meta verisi izin tablosuyla eşleşir (KK-042-12); uyuşmazlık açılış hatası', () => {
    const r = new RouteRegistry();
    expect(() =>
      r.add('delete', '/api/v1/org/members/{memberId}', {
        ...meta({}),
        permission: 'org:member_manage',
      }),
    ).toThrow(/step-up/);
    expect(() =>
      r.add('get', '/api/v1/org/members', {
        ...meta({}),
        permission: 'org:member_read',
        stepUp: true,
      }),
    ).toThrow(/step-up/);
    for (const [p, rule] of Object.entries(PERMISSIONS)) {
      expect(stepUpExpected('POST', '/api/v1/x', p)).toBe(rule.stepUp);
    }
    expect(stepUpExpected('POST', '/api/v1/me/data-exports', 'self')).toBe(true);
    expect(stepUpExpected('GET', '/api/v1/me', 'self')).toBe(false);
  });

  it('clientData yalnız 042 §5.1 listesindeki rotalarda', () => {
    const r = new RouteRegistry();
    expect(() =>
      r.add('get', '/api/v1/org', meta({ permission: 'org:read', clientData: true })),
    ).toThrow(/clientData/);
    expect(() =>
      r.add('post', '/api/v1/cases', meta({ permission: 'case:write', clientData: false })),
    ).toThrow(/clientData/);
    r.add('post', '/api/v1/cases', meta({ permission: 'case:write', clientData: true }));
    expect(CLIENT_DATA_ROUTES).toContain('POST /api/v1/files');
  });

  it('idempotent rota yanıt şeması vermeli ve serbest metin taşımamalı (040 §10)', () => {
    const r = new RouteRegistry();
    const m = { ...meta({}), permission: 'org:member_invite', idempotency: 'required' as const };
    expect(() => r.add('post', '/api/v1/a', m)).toThrow(/yanıt şeması/);
    expect(() => r.add('post', '/api/v1/b', m, { response: InvitationDto })).toThrow(
      /serbest metin/,
    );
    expect(freeTextFields(InvitationCreatedDto)).toEqual([]);
    expect(freeTextFields(InvitationDto)).toEqual(['.email']);
  });

  it('idempotency gövde özeti anahtar sırasından bağımsızdır', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(
      canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }),
    );
  });
});

describe('KK-P04b-5 (KK-042-2 genişletilmiş): yol izin listesi', () => {
  it('büro yönetimi, get-totp-uri ve admin/* kapalı; kurulu uçlar doğru yöntemle açık', () => {
    for (const p of [
      'organization/create',
      'organization/update',
      'organization/delete',
      'organization/invite-member',
      'organization/remove-member',
      'organization/update-member-role',
      'organization/leave',
      'two-factor/get-totp-uri',
      'admin/set-role',
      'admin/create-user',
    ]) {
      expect(isAllowedAuthRequest('POST', `/api/auth/${p}`), p).toBe(false);
    }
    for (const [m, p] of [
      ['POST', 'organization/set-active'],
      ['GET', 'organization/get-invitation'],
      ['POST', 'organization/accept-invitation'],
      ['POST', 'organization/reject-invitation'],
      ['POST', 'two-factor/enable'],
      ['POST', 'two-factor/verify-totp'],
      ['GET', 'passkey/generate-register-options'],
      ['POST', 'passkey/verify-authentication'],
    ] as const) {
      expect(isAllowedAuthRequest(m, `/api/auth/${p}`), p).toBe(true);
    }
    expect(isAllowedAuthRequest('POST', '/api/auth/passkey/generate-register-options')).toBe(false);
  });
});
