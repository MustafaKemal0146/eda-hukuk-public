// Yönetim oturumu bitiş kapısı (saf model + küçük tekil durum). Oturum sayfa AÇIKKEN biterse (mutlak 12
// saat, iptal) her veri çekme 401 alır. Bu modül 401'i TEK yerde yakalar: ilk 401'de kapı kapanır, sonraki
// tüm `adminFetch` çağrıları ağa çıkmadan reddedilir (yoklama/yeniden deneme fırtınası olmaz) ve kullanıcı
// girişe yönlendirilir. 403 `ADMIN_FORBIDDEN` ayrı kalır: step-up diyaloğu veya bölüm içi hata.

export const LOGIN_PATH = '/giris';
export const SESSION_ENDED_PARAM = 'durum';
export const SESSION_ENDED_VALUE = 'oturum-bitti';
/** Girişe yönlendirme adresi: yalnız sabit, kullanıcı girdisi içermeyen değer. */
export const SESSION_ENDED_HREF = `${LOGIN_PATH}?${SESSION_ENDED_PARAM}=${SESSION_ENDED_VALUE}`;

export type LoginNotice = 'sessionEnded';

// Beyaz liste: sorgu değeri hiçbir zaman ham basılmaz; yalnız bilinen anahtar bir ileti anahtarına eşlenir.
const NOTICES: ReadonlyMap<string, LoginNotice> = new Map([[SESSION_ENDED_VALUE, 'sessionEnded']]);

/** `?durum=` değerini ileti anahtarına çevirir; bilinmeyen, dizi veya boş değer `null`. */
export function parseLoginNotice(raw: unknown): LoginNotice | null {
  return typeof raw === 'string' ? (NOTICES.get(raw) ?? null) : null;
}

export type AdminFailureKind =
  | 'session_ended'
  | 'step_up'
  | 'permission_missing'
  | 'forbidden'
  | 'other';

/** Hata -> davranış: yalnız `session_ended` girişe götürür. */
export function classifyAdminFailure(
  status: number,
  code: string,
  reason: string | null,
): AdminFailureKind {
  if (status === 401 || code === 'AUTH_SESSION_EXPIRED' || code === 'AUTH_UNAUTHENTICATED') {
    return 'session_ended';
  }
  if (code === 'AUTH_STEP_UP_REQUIRED') return 'step_up';
  if (code === 'ADMIN_FORBIDDEN') {
    if (reason === 'passkey_required') return 'step_up';
    if (reason === 'permission_missing') return 'permission_missing';
    return 'forbidden';
  }
  return 'other';
}

/** Giriş sayfasında (veya altında) miyiz? Orada 401 yönlendirme üretmez (döngü olmaz). */
export const isLoginPath = (pathname: string): boolean =>
  pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);

export interface SessionGuard {
  /** Oturum bitti olarak işaretlendi mi? */
  readonly ended: boolean;
  /** Kapıyı kapatır; yalnız İLK çağrıda `true` döner ve `onEnd` bir kez çalışır. */
  trip(): boolean;
  reset(): void;
}

export function createSessionGuard(onEnd: () => void): SessionGuard {
  let ended = false;
  return {
    get ended() {
      return ended;
    },
    trip() {
      if (ended) return false;
      ended = true;
      onEnd();
      return true;
    },
    reset() {
      ended = false;
    },
  };
}

type Navigate = (href: string) => void;
let navigate: Navigate | null = null;

const guard = createSessionGuard(() => {
  if (navigate !== null) navigate(SESSION_ENDED_HREF);
  else if (typeof window !== 'undefined') window.location.replace(SESSION_ENDED_HREF);
});

/** Kabuk, yönlendirmeyi kendi `router`ı ile yapmak için kaydolur; dönen işlev kaydı siler. */
export function setSessionEndNavigator(fn: Navigate): () => void {
  navigate = fn;
  return () => {
    if (navigate === fn) navigate = null;
  };
}

/** Bir veri çekme 401 aldı. Giriş sayfasındaysak yok sayılır (kendi 401'ini yakalamaz). */
export function reportSessionEnded(pathname: string): void {
  if (isLoginPath(pathname)) return;
  guard.trip();
}

export const isSessionEndedLatched = (): boolean => guard.ended;

/** Giriş sayfası açılınca çağrılır: yeni oturumda istekler yeniden serbest kalır. */
export function resetSessionGuard(): void {
  guard.reset();
}
