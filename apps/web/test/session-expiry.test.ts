// @tk TK-33
// Oturum sayfa açıkken biterse (issue #71): `/api/v1/*` 401'i tek yerde (guardedFetch) yakalanır, istekler
// durur, kullanıcı güvenli dönüş yoluyla girişe yönlenir, taslak korunur, giriş sayfası döngü üretmez.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError, authRedirectFor } from '../src/features/studio/documents-api.ts';
import { authTargetFor } from '../src/lib/auth-redirect.ts';
import { DRAFT_MAX_CHARS, DRAFT_TTL_MS, stashDraft, takeDraft } from '../src/lib/draft-stash.ts';
import {
  APP_PATH_ROOTS,
  createSessionGuard,
  guardedFetch,
  isAppPath,
  isGuardedApiUrl,
  onSessionEnded,
  parseLoginReason,
  REDIRECT_COOLDOWN_MS,
  reportSessionEnded,
  resetSessionGuard,
  sessionEndedHref,
  setSessionEndNavigator,
} from '../src/lib/session-guard.ts';

const messages = JSON.parse(
  readFileSync(new URL('../messages/tr.json', import.meta.url), 'utf8'),
) as {
  auth: { login: { reasons: Record<string, string> } };
};

function memoryStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}

const unauthorized = () =>
  new Response(JSON.stringify({ error: { code: 'AUTH_UNAUTHENTICATED', requestId: 'r' } }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });

describe('KK-OTURUM-W1: 401 tek yerde yakalanır, yoklama durur', () => {
  const nav = vi.fn();
  const replace = vi.fn();
  let off: () => void;
  beforeEach(() => {
    resetSessionGuard();
    nav.mockReset();
    replace.mockReset();
    off = setSessionEndNavigator(nav);
    vi.stubGlobal('window', {
      location: { pathname: '/sohbet/abc-123', replace },
      sessionStorage: memoryStore(),
    });
  });
  afterEach(() => {
    off();
    resetSessionGuard();
    vi.unstubAllGlobals();
  });

  it('ilk 401 sonrası ağa çıkılmaz; tek yönlendirme, güvenli dönüş yoluyla', async () => {
    const f = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', f);
    const statuses: number[] = [];
    for (let i = 0; i < 30; i++)
      statuses.push((await guardedFetch('/api/v1/conversations')).status);
    expect(f).toHaveBeenCalledTimes(1);
    expect(statuses.every((s) => s === 401)).toBe(true);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith(
      '/giris?sonraki=%2Fsohbet%2Fabc-123&neden=oturum-suresi-doldu',
    );
  });

  it('aboneler (açık akış, taslak) bir kez çağrılır; hatalı abone yönlendirmeyi engellemez', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorized()),
    );
    const a = vi.fn(() => {
      throw new Error('x');
    });
    const b = vi.fn();
    const offA = onSessionEnded(a);
    const offB = onSessionEnded(b);
    await guardedFetch('/api/v1/me');
    await guardedFetch('/api/v1/me');
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it('kabuk kaydı yoksa window.location.replace ile yönlenir', async () => {
    off();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorized()),
    );
    await guardedFetch('/api/v1/me');
    expect(replace).toHaveBeenCalledTimes(1);
    off = setSessionEndNavigator(nav);
  });

  it('/api/auth 401 (yanlış parola) ve diğer durumlar kapıyı kapatmaz', async () => {
    const f = vi.fn(async () => unauthorized());
    vi.stubGlobal('fetch', f);
    await guardedFetch('/api/auth/sign-in/email');
    await guardedFetch('/api/auth/sign-in/email');
    expect(f).toHaveBeenCalledTimes(2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    expect((await guardedFetch('/api/v1/conversations')).status).toBe(403);
    expect(nav).not.toHaveBeenCalled();
  });

  it('giriş sayfasında ve pazarlama sayfasında 401 yönlendirme üretmez (döngü yok)', () => {
    for (const p of ['/giris', '/kayit', '/iki-adimli', '/eposta-dogrulama', '/', '/yasal/kvkk']) {
      reportSessionEnded(p);
    }
    expect(nav).not.toHaveBeenCalled();
    reportSessionEnded('/ayarlar'); // kapı hâlâ açık: uygulama sayfasında çalışır
    expect(nav).toHaveBeenCalledTimes(1);
  });

  it('döngü kırıcı: yönlendirmeden hemen sonra tekrar 401 gelirse ikinci yönlendirme yapılmaz', () => {
    reportSessionEnded('/sohbet', 1_000);
    resetSessionGuard(); // sunucu girişi geri gönderdi, form hiç açılmadı gibi
    reportSessionEnded('/sohbet', 1_000 + REDIRECT_COOLDOWN_MS - 1);
    expect(nav).toHaveBeenCalledTimes(1);
    resetSessionGuard();
    reportSessionEnded('/sohbet', 1_000 + REDIRECT_COOLDOWN_MS + 1);
    expect(nav).toHaveBeenCalledTimes(2);
  });

  it('giriş formu kapıyı sıfırlayınca yeni oturum istek atabilir', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => unauthorized()),
    );
    await guardedFetch('/api/v1/me');
    resetSessionGuard();
    const ok = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', ok);
    expect((await guardedFetch('/api/v1/me')).status).toBe(200);
    expect(ok).toHaveBeenCalledTimes(1);
  });
});

describe('KK-OTURUM-W2: saf model', () => {
  it('dönüş yolu güvenli iç yola indirgenir (açık yönlendirme yok)', () => {
    expect(sessionEndedHref('/belgeler/abc')).toBe(
      '/giris?sonraki=%2Fbelgeler%2Fabc&neden=oturum-suresi-doldu',
    );
    for (const bad of ['//evil.example', 'https://evil.example', '/a?b=1', '', null, undefined]) {
      expect(sessionEndedHref(bad)).toBe('/giris?sonraki=%2Fsohbet&neden=oturum-suresi-doldu');
    }
    expect(
      authTargetFor(
        { code: 'AUTH_MFA_REQUIRED', message: null, requestId: null, status: 403 },
        '/takvim',
      ),
    ).toBe('/iki-adimli?mod=kurulum&sonraki=%2Ftakvim');
  });

  it('?neden= beyaz listedir; bilinmeyen değer ham basılmaz', () => {
    expect(parseLoginReason('oturum-suresi-doldu')).toBe('expired');
    expect(parseLoginReason('cikis-yapildi')).toBe('signedOut');
    for (const bad of [
      '<img src=x onerror=1>',
      '__proto__',
      'constructor',
      'toString',
      '',
      null,
      undefined,
    ]) {
      expect(parseLoginReason(bad)).toBeNull();
    }
    expect(messages.auth.login.reasons.expired).toBe(
      'Oturumunuz sona erdi. Devam etmek için yeniden giriş yapın.',
    );
  });

  it('korumalı yol kökleri ve api URL ayrımı', () => {
    expect(isAppPath('/sohbet')).toBe(true);
    expect(isAppPath('/sohbet/abc')).toBe(true);
    expect(isAppPath('/sohbetx')).toBe(false);
    expect(isAppPath('/giris')).toBe(false);
    expect(APP_PATH_ROOTS).toContain('/ayarlar');
    expect(isGuardedApiUrl('/api/v1/me')).toBe(true);
    expect(isGuardedApiUrl('https://app.eda.localhost:8443/api/v1/me')).toBe(true);
    expect(isGuardedApiUrl('/api/auth/sign-in/email')).toBe(false);
  });

  it('kapı yalnız ilk trip te true', () => {
    const g = createSessionGuard();
    expect(g.trip()).toBe(true);
    expect(g.trip()).toBe(false);
    g.reset();
    expect(g.ended).toBe(false);
  });
});

describe('KK-OTURUM-W5: ekran başına yönlendirme yok (döngü yok)', () => {
  it('authTargetFor/authRedirectFor 401de href döndürmez; kapıya bildirir, yönlendirmeyi kapı yapar', async () => {
    const nav = vi.fn();
    resetSessionGuard();
    const off = setSessionEndNavigator(nav);
    vi.stubGlobal('window', {
      location: { pathname: '/takvim', replace: vi.fn() },
      sessionStorage: memoryStore(),
    });
    const info = { code: 'AUTH_UNAUTHENTICATED', message: null, requestId: null, status: 401 };
    expect(authTargetFor(info, '/takvim')).toBeNull();
    expect(authTargetFor(info, '/takvim')).toBeNull();
    expect(
      authRedirectFor(new ApiClientError(401, 'AUTH_UNAUTHENTICATED', null, null, null), '/takvim'),
    ).toBeNull();
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith('/giris?sonraki=%2Ftakvim&neden=oturum-suresi-doldu');
    off();
    resetSessionGuard();
    vi.unstubAllGlobals();
  });
});

describe('KK-OTURUM-W3: taslak korunur', () => {
  it('saklanır, bir kez okunur ve silinir; süresi dolan ve boş taslak atılır', () => {
    const s = memoryStore();
    stashDraft('/sohbet/abc', 'Dilekçe taslağı notu', 1_000, s);
    expect(takeDraft('/sohbet/abc', 2_000, s)).toBe('Dilekçe taslağı notu');
    expect(takeDraft('/sohbet/abc', 2_000, s)).toBeNull();
    stashDraft('/sohbet', 'eski', 1_000, s);
    expect(takeDraft('/sohbet', 1_000 + DRAFT_TTL_MS + 1, s)).toBeNull();
    stashDraft('/sohbet', '   ', 1_000, s);
    expect(s.raw.size).toBe(0);
  });

  it('uzunluk sınırı; bozuk kayıt ve kapalı depolama sessizce atlanır; yol başına ayrı', () => {
    const s = memoryStore();
    stashDraft('/sohbet', 'a'.repeat(DRAFT_MAX_CHARS + 50), 1, s);
    expect(takeDraft('/sohbet', 2, s)?.length).toBe(DRAFT_MAX_CHARS);
    s.setItem('eda:draft:/sohbet', '{bozuk');
    expect(takeDraft('/sohbet', 2, s)).toBeNull();
    stashDraft('/sohbet/a', 'x', 1, s);
    expect(takeDraft('/sohbet/b', 2, s)).toBeNull();
    expect(() => stashDraft('/sohbet', 'x', 1, null)).not.toThrow();
    expect(takeDraft('/sohbet', 1, null)).toBeNull();
  });
});

describe('KK-OTURUM-W4: misafir satırı', () => {
  it('kenar çubuğunda "Misafir" yok; oturumsuz satır "Giriş yap" der', () => {
    const tr = JSON.parse(
      readFileSync(new URL('../messages/tr.json', import.meta.url), 'utf8'),
    ) as {
      topbar: Record<string, string>;
    };
    expect(tr.topbar.guest).toBeUndefined();
    expect(tr.topbar.signIn).toBe('Giriş yap');
    const src = readFileSync(
      new URL('../src/features/shell/account-block.tsx', import.meta.url),
      'utf8',
    );
    expect(src).not.toContain('topbar.guest');
  });
});
