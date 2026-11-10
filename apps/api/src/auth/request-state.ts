// Kimlik isteği durumu (P04b): Better Auth `hooks.before` -> uç -> `databaseHooks` -> `hooks.after`
// zincirinde aynı istek içinde taşınan küçük bayraklar (TOTP tekrar kullanım anahtarı, 2FA akış türü,
// oturum açılışının giriş mi döndürme mi olduğu). Modül değişkeninde istek durumu tutulmaz; yalnız
// `AsyncLocalStorage`. İçerik (kod, parola, belirteç) burada saklanmaz; anahtar özettir.
import { AsyncLocalStorage } from 'node:async_hooks';

export type MfaFlow = 'enroll' | 'signin' | 'verify';

export interface AuthRequestState {
  /** `eda:auth:totp-used:<userId>:<sha256>` (başarısız doğrulamada silinir). */
  replayKey?: string;
  /** TOTP/yedek kod akışı: etkinleştirme, ikinci adım girişi veya oturumlu doğrulama. */
  mfaFlow?: MfaFlow;
  /** Akışın kullanıcısı (2FA girişinde çerezden çözülür). */
  flowUserId?: string;
  /** Açılan oturum önceki oturumun alanlarıyla döndürüldü mü (giriş denetimi yazılmaz). */
  rotated?: boolean;
  /** Başarısız giriş denetimi bu istekte zaten yazıldı (çift kayıt olmasın). */
  failureAudited?: boolean;
}

const als = new AsyncLocalStorage<AuthRequestState>();

export function runWithAuthState<T>(fn: () => Promise<T>): Promise<T> {
  return als.run({}, fn);
}

/** Geçerli istek durumu; Better Auth sunucu API'si ALS dışında çağrılırsa geçici nesne. */
export function authState(): AuthRequestState {
  return als.getStore() ?? {};
}
