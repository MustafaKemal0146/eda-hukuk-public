// API hatasından kimlik yönlendirmesi. 401 (oturum bitti) TEK yerde, `session-guard`da yönetilir: bu
// işlev 401'de kapıyı bildirir (yönlendirmeyi kapı yapar; döngü kırıcısı orada) ve `null` döner, böylece
// ekranlar kendi başlarına tekrar tekrar girişe yönlendirmez. İki adımlı doğrulama gerekiyorsa kuruluma.
import type { ApiErrorInfo } from './api-error.ts';
import { reportSessionEnded } from './session-guard.ts';

export function authTargetFor(info: ApiErrorInfo, here: string): string | null {
  const next = encodeURIComponent(here);
  if (info.status === 401 || info.code === 'AUTH_UNAUTHENTICATED') {
    reportSessionEnded(here);
    return null;
  }
  if (info.code === 'AUTH_MFA_REQUIRED') return `/iki-adimli?mod=kurulum&sonraki=${next}`;
  return null;
}
