'use client';
// Kimlik hata/bilgi bandı: hata kodunu katalog metnine çevirir; 429'da `Retry-After` kalan süreyi yazar.
import { NoticeBanner } from '@eda/ui';
import { useTranslations } from 'next-intl';
import type { AuthApiError } from '../../lib/auth-api.ts';
import { authErrorKey } from './error-map.ts';

export function AuthErrorNotice({
  error,
  waitLeft = 0,
  focusRef,
}: {
  error: AuthApiError;
  /** Kalan bekleme (sn); 0 ise `Retry-After` yok sayılır. */
  waitLeft?: number;
  focusRef?: React.Ref<HTMLDivElement>;
}) {
  const t = useTranslations('auth.errors');
  const key = authErrorKey(error);
  const text =
    key === 'rateLimited'
      ? waitLeft > 0
        ? t('rateLimited', { n: waitLeft })
        : t('rateLimitedNoWait')
      : t(key);
  return (
    <div ref={focusRef} tabIndex={-1} className="focus-visible:focus-ring">
      <NoticeBanner tone="danger" role="alert">
        {text}
        {error.requestId && (
          <span className="block text-caption">{t('supportCode', { code: error.requestId })}</span>
        )}
      </NoticeBanner>
    </div>
  );
}
