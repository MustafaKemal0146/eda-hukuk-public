// @tk TK-28
// Oturum sayfa açıkken biterse (issue #71 / pilot gözlemi): 401 tek yerde yakalanır, yoklama durur,
// kullanıcı girişe yönlenir; 403 ADMIN_FORBIDDEN ayrı kalır; not metni beyaz listeden gelir.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminApiError,
  adminFetch,
  isPermissionMissing,
  isSessionGone,
  isStepUp,
} from '../src/lib/admin-api.ts';
import {
  classifyAdminFailure,
  createSessionGuard,
  isLoginPath,
  parseLoginNotice,
  resetSessionGuard,
  SESSION_ENDED_HREF,
  setSessionEndNavigator,
} from '../src/lib/session-guard.ts';

const messages = JSON.parse(
  readFileSync(new URL('../messages/tr.json', import.meta.url), 'utf8'),
) as { login: Record<string, unknown> };

const envelope = (status: number, code: string, reason?: string) =>
  new Response(
    JSON.stringify({ error: { code, requestId: 'r1', ...(reason ? { reason } : {}) } }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    },
  );

describe('KK-OTURUM-01: 401 bir kez yakalanır, istekler durur', () => {
  const nav = vi.fn();
  let off: () => void;
  beforeEach(() => {
    resetSessionGuard();
    nav.mockReset();
    off = setSessionEndNavigator(nav);
  });
  afterEach(() => {
    off();
    resetSessionGuard();
    vi.unstubAllGlobals();
  });

  it('saniyede bir yoklama 401 alınca ilk istekten sonra ağa çıkılmaz ve tek yönlendirme olur', async () => {
    const fetchMock = vi.fn(async () => envelope(401, 'AUTH_SESSION_EXPIRED'));
    vi.stubGlobal('fetch', fetchMock);
    const results: unknown[] = [];
    for (let i = 0; i < 25; i++) {
      results.push(await adminFetch('/overview').catch((e: unknown) => e));
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(SESSION_ENDED_HREF);
    expect(results.every((e) => isSessionGone(e))).toBe(true);
  });

  it('giriş sayfasında 401 yönlendirme üretmez (döngü yok)', async () => {
    vi.stubGlobal('window', { location: { pathname: '/giris', replace: vi.fn() } });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelope(401, 'AUTH_UNAUTHENTICATED')),
    );
    await adminFetch('/me').catch(() => undefined);
    expect(nav).not.toHaveBeenCalled();
    // Kapı kapanmadı: giriş sonrası istekler ağa çıkabilir.
    const f = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await adminFetch('/me');
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('girişte kapı sıfırlanınca yeni oturum istek atabilir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelope(401, 'AUTH_SESSION_EXPIRED')),
    );
    await adminFetch('/overview').catch(() => undefined);
    resetSessionGuard();
    const f = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', f);
    await expect(adminFetch('/overview')).resolves.toEqual({ ok: true });
  });

  it('403 ADMIN_FORBIDDEN girişe atmaz ve kapıyı kapatmaz', async () => {
    const f = vi.fn(async () => envelope(403, 'ADMIN_FORBIDDEN', 'permission_missing'));
    vi.stubGlobal('fetch', f);
    const e = await adminFetch('/users').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AdminApiError);
    expect(isPermissionMissing(e)).toBe(true);
    expect(isSessionGone(e)).toBe(false);
    expect(isStepUp(e)).toBe(false);
    await adminFetch('/users').catch(() => undefined);
    expect(f).toHaveBeenCalledTimes(2);
    expect(nav).not.toHaveBeenCalled();
  });

  it('step-up 403 (AUTH_STEP_UP_REQUIRED, passkey_required) step-up sayılır, girişe atmaz', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelope(403, 'AUTH_STEP_UP_REQUIRED')),
    );
    const a = await adminFetch('/x', { method: 'POST', body: {} }).catch((x: unknown) => x);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelope(403, 'ADMIN_FORBIDDEN', 'passkey_required')),
    );
    const b = await adminFetch('/x').catch((x: unknown) => x);
    expect(isStepUp(a)).toBe(true);
    expect(isStepUp(b)).toBe(true);
    expect(nav).not.toHaveBeenCalled();
  });
});

describe('KK-OTURUM-02: sınıflandırma ve saf kapı', () => {
  it('durum/kod -> davranış', () => {
    expect(classifyAdminFailure(401, 'AUTH_UNAUTHENTICATED', null)).toBe('session_ended');
    expect(classifyAdminFailure(401, 'AUTH_SESSION_EXPIRED', 'absolute_timeout')).toBe(
      'session_ended',
    );
    expect(classifyAdminFailure(403, 'AUTH_STEP_UP_REQUIRED', null)).toBe('step_up');
    expect(classifyAdminFailure(403, 'ADMIN_FORBIDDEN', 'passkey_required')).toBe('step_up');
    expect(classifyAdminFailure(403, 'ADMIN_FORBIDDEN', 'permission_missing')).toBe(
      'permission_missing',
    );
    expect(classifyAdminFailure(403, 'ADMIN_FORBIDDEN', 'not_staff')).toBe('forbidden');
    expect(classifyAdminFailure(500, 'INTERNAL_ERROR', null)).toBe('other');
  });

  it('kapı yalnız ilk trip te tetiklenir; reset sonrası yeniden', () => {
    const on = vi.fn();
    const g = createSessionGuard(on);
    expect(g.trip()).toBe(true);
    expect(g.trip()).toBe(false);
    expect(on).toHaveBeenCalledTimes(1);
    expect(g.ended).toBe(true);
    g.reset();
    expect(g.trip()).toBe(true);
    expect(on).toHaveBeenCalledTimes(2);
  });

  it('giriş yolu tanıma', () => {
    expect(isLoginPath('/giris')).toBe(true);
    expect(isLoginPath('/giris/x')).toBe(true);
    expect(isLoginPath('/girisx')).toBe(false);
    expect(isLoginPath('/')).toBe(false);
  });
});

describe('KK-OTURUM-03: giriş notu beyaz liste', () => {
  it('yalnız bilinen değer ileti anahtarı olur', () => {
    expect(parseLoginNotice('oturum-bitti')).toBe('sessionEnded');
    for (const bad of [
      '<script>alert(1)</script>',
      '__proto__',
      'constructor',
      'toString',
      '',
      ['oturum-bitti'],
      undefined,
      null,
      42,
    ]) {
      expect(parseLoginNotice(bad)).toBeNull();
    }
  });

  it('yönlendirme adresi sabittir ve not metni katalogdadır', () => {
    expect(SESSION_ENDED_HREF).toBe('/giris?durum=oturum-bitti');
    expect(messages.login.sessionEnded).toBe('Oturumunuz sona erdi, yeniden giriş yapın.');
  });
});
