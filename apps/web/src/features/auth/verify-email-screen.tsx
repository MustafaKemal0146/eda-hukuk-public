'use client';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
// `/eposta-dogrulama` (053-01 §6): belirteç varsa doğrulanır; yoksa yeniden gönderme formu. Başarıda
// otomatik yönlendirme YOKTUR (WCAG 2.2.1); "Devam et" düğmesi profil durumuna göre yönlendirir.
import { normalizeEmail } from '@eda/legal/text';
import { Button, Field, Input, NoticeBanner } from '@eda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthApiError, getMe, sendVerificationEmail, verifyEmail } from '../../lib/auth-api.ts';
import { AuthErrorNotice } from './auth-notice.tsx';
import { takeUrlToken } from './url-token.ts';
import { useCountdown } from './use-countdown.ts';

type View = 'form' | 'checking' | 'ok' | 'already' | 'error';

export function VerifyEmailScreen() {
  const t = useTranslations('auth.verifyEmail');
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get('durum');
  const [view, setView] = useState<View>(
    status === 'basarili'
      ? 'ok'
      : status === 'zaten-dogrulandi'
        ? 'already'
        : status === 'hata'
          ? 'error'
          : 'form',
  );
  const [email, setEmail] = useState('');
  const [neutral, setNeutral] = useState(false);
  const [error, setError] = useState<AuthApiError | null>(null);
  const wait = useCountdown();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = takeUrlToken();
    if (token === null) return;
    setView('checking');
    verifyEmail(token)
      .then(() => setView('ok'))
      .catch(() => setView('error'));
  }, []);

  async function resend(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const normalized = normalizeEmail(email);
    if (normalized === null || wait.left > 0) return;
    try {
      await sendVerificationEmail({
        email: normalized,
        callbackURL: '/eposta-dogrulama?durum=basarili',
      });
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 429) {
        if (err.retryAfterSec) wait.start(err.retryAfterSec);
        setError(err);
        return;
      }
    }
    setNeutral(true);
    wait.start(CONFIG_DEFAULTS['ui.resendCooldownSec']);
  }

  async function proceed() {
    try {
      const me = await getMe();
      router.replace(me.hasProfile ? '/sohbet' : '/kayit?adim=meslek');
      router.refresh();
    } catch {
      router.replace('/giris?sonraki=/kayit');
    }
  }

  if (view === 'checking') {
    return (
      <p role="status" aria-busy="true" className="text-body text-fg-muted">
        {t('checking')}
      </p>
    );
  }
  if (view === 'ok' || view === 'already') {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-display text-heading-lg text-fg">
          {view === 'ok' ? t('success') : t('already')}
        </h1>
        {view === 'ok' ? (
          <Button type="button" onClick={() => void proceed()}>
            {t('continue')}
          </Button>
        ) : (
          <Button render={<Link href="/giris" />}>{t('login')}</Button>
        )}
      </div>
    );
  }
  return (
    <form noValidate onSubmit={resend} className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">{t('intro')}</p>
      </div>
      {view === 'error' && (
        <NoticeBanner tone="danger" role="alert">
          {t('error')}
        </NoticeBanner>
      )}
      {error && <AuthErrorNotice error={error} waitLeft={wait.left} />}
      {neutral && (
        <NoticeBanner tone="info" role="status">
          {t('neutral')}
        </NoticeBanner>
      )}
      <Field label={t('email')}>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
        />
      </Field>
      <Button type="submit" disabled={wait.left > 0}>
        {t('resend')}
      </Button>
    </form>
  );
}
