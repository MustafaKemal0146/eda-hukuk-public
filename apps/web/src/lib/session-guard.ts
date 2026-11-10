// Uygulama oturumu bitiş kapısı (issue #71). Oturum sayfa AÇIKKEN biterse (süre dolması, başka cihazdan
// çıkış) her `/api/v1/*` isteği 401 alır. `guardedFetch` bunu TEK yerde yakalar: ilk 401'de kapı kapanır,
// abone olan ekranlar (açık sohbet akışı, taslak) durdurulur ve kullanıcı `/giris?sonraki=...` adresine
// yönlenir; sonraki tüm istekler ağa çıkmadan 401 döner (yoklama/yeniden deneme fırtınası olmaz).
// Giriş sayfaları kapıyı kullanmaz ve bu kapıdan yönlendirilmez (döngü olmaz). Yönlendirme güvenlik
// sınırı değildir; veriyi api korur.
import { safeNext } from './safe-next.ts';

/** `?neden=` değerleri (beyaz liste); giriş formundaki ileti anahtarlarına buradan eşlenir. */
export const LOGIN_REASONS = {
  'oturum-suresi-doldu': 'expired',
  'cikis-yapildi': 'signedOut',
  'parola-guncellendi': 'passwordUpdated',
} as const;
export type LoginReason = (typeof LOGIN_REASONS)[keyof typeof LOGIN_REASONS];
export const SESSION_ENDED_REASON = 'oturum-suresi-doldu';

/** `?neden=` -> ileti anahtarı; bilinmeyen değer `null` (ham metin hiçbir zaman basılmaz). */
export function parseLoginReason(raw: string | null | undefined): LoginReason | null {
  if (typeof raw !== 'string' || !Object.hasOwn(LOGIN_REASONS, raw)) return null;
  return LOGIN_REASONS[raw as keyof typeof LOGIN_REASONS];
}

/** Oturum gerektiren sayfa kökleri ((app) grubu); `proxy.ts` ile ortaktır. */
export const APP_PATH_ROOTS = [
  '/sohbet',
  '/belgeler',
  '/dosyalar',
  '/takvim',
  '/karar-arsivi',
  '/mevzuat',
  '/donusturucu',
  '/ayarlar',
] as const;

export const isAppPath = (pathname: string): boolean =>
  APP_PATH_ROOTS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** Oturum bitti adresi; dönüş yolu `safeNext` ile doğrulanır (açık yönlendirme yok). */
export function sessionEndedHref(pathname: string | null | undefined): string {
  return `/giris?sonraki=${encodeURIComponent(safeNext(pathname))}&neden=${SESSION_ENDED_REASON}`;
}

/** Yalnız aynı origin `/api/v1/` istekleri kapıya girer (`/api/auth/*` yanlış parola 401'i sayılmaz). */
export function isGuardedApiUrl(url: string): boolean {
  return url.startsWith('/api/v1/') || /^https?:\/\/[^/]+\/api\/v1\//.test(url);
}

export interface SessionGuard {
  readonly ended: boolean;
  /** Kapıyı kapatır; yalnız İLK çağrıda `true` döner. */
  trip(): boolean;
  reset(): void;
}

export function createSessionGuard(): SessionGuard {
  let ended = false;
  return {
    get ended() {
      return ended;
    },
    trip() {
      if (ended) return false;
      ended = true;
      return true;
    },
    reset() {
      ended = false;
    },
  };
}

/** Kapı kapalıyken ağa çıkmadan dönen yanıt (044 zarfı; çağıranlar olağan 401 yolunu izler). */
export function expiredResponse(): Response {
  return new Response(
    JSON.stringify({ error: { code: 'AUTH_SESSION_EXPIRED', message: null, requestId: null } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );
}

type Listener = () => void;
const listeners = new Set<Listener>();
let navigate: ((href: string) => void) | null = null;
const guard = createSessionGuard();

/** Oturum bitince çalışır (sohbet akışını durdur, taslağı sakla); dönen işlev aboneliği siler. */
export function onSessionEnded(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Kabuk yönlendirmeyi kendi `router`ı ile yapar; dönen işlev kaydı siler. */
export function setSessionEndNavigator(fn: (href: string) => void): () => void {
  navigate = fn;
  return () => {
    if (navigate === fn) navigate = null;
  };
}

/** Son iki yönlendirme arasında bu süreden azsa tekrar yönlendirilmez (sunucu/istemci döngü kıran). */
export const REDIRECT_COOLDOWN_MS = 5_000;
const LAST_KEY = 'eda:session-ended-at';

function recentlyRedirected(now: number): boolean {
  try {
    const raw = window.sessionStorage.getItem(LAST_KEY);
    const last = raw === null ? Number.NaN : Number(raw);
    return Number.isFinite(last) && now - last >= 0 && now - last < REDIRECT_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markRedirected(now: number): void {
  try {
    window.sessionStorage.setItem(LAST_KEY, String(now));
  } catch {
    // depolama kapalı
  }
}

/** Bir `/api/v1/*` isteği 401 aldı. Uygulama sayfası değilsek (giriş, pazarlama) yok sayılır. */
export function reportSessionEnded(pathname: string, now: number = Date.now()): void {
  if (!isAppPath(pathname)) return;
  if (!guard.trip()) return;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // bir abonenin hatası yönlendirmeyi engellemez
    }
  }
  if (recentlyRedirected(now)) return;
  markRedirected(now);
  const href = sessionEndedHref(pathname);
  if (navigate !== null) navigate(href);
  else window.location.replace(href);
}

export const isSessionEndedLatched = (): boolean => guard.ended;

/** Giriş formu açılınca çağrılır: yeni oturumda istekler yeniden serbest kalır. */
export function resetSessionGuard(): void {
  guard.reset();
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

/** `fetch` yerine kullanılır: 401'i tek yerde yakalar, kapı kapalıyken ağa çıkmaz. */
export const guardedFetch: typeof fetch = async (input, init) => {
  const guarded = isGuardedApiUrl(urlOf(input));
  if (guarded && guard.ended) return expiredResponse();
  const res = await fetch(input, init);
  if (guarded && res.status === 401) {
    reportSessionEnded(typeof window === 'undefined' ? '' : window.location.pathname);
  }
  return res;
};
