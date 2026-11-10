// Belge API istemcisi (tarayıcı, aynı origin) ve ortak hata yönlendirmesi.
import { ApiClientError, createDocumentsClient } from '@eda/api-client/endpoints/documents';
import { guardedFetch, reportSessionEnded } from '../../lib/session-guard.ts';

export const documentsApi = createDocumentsClient({ fetch: guardedFetch });
export { ApiClientError };

/** MFA hatası ise gidilecek adres; aksi hâlde `null` (çağıran kendi hatasını gösterir). 401 kapıya bildirilir. */
export function authRedirectFor(err: unknown, nextPath: string): string | null {
  if (!(err instanceof ApiClientError)) return null;
  const next = encodeURIComponent(nextPath);
  if (err.status === 401) {
    // Oturum bitti: yönlendirmeyi tek yerdeki kapı yapar (döngü kırıcısı orada); ekran hata durumuna düşer.
    reportSessionEnded(nextPath);
    return null;
  }
  if (err.code === 'AUTH_MFA_REQUIRED') return `/iki-adimli?mod=kurulum&sonraki=${next}`;
  return null;
}
