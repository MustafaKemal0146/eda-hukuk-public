'use client';
// `/sifre-sifirla` (053-01 §7): istek (yanıt her zaman nötr) ve belirteçle yeni parola.
// Başarıda `/giris?neden=parola-guncellendi`; açık oturumlar api'de kapanır, MFA yine istenir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { normalizeEmail } from '@eda/legal/text';
import { Button, Field, Input, NoticeBanner, PasswordInput } from '@eda/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthApiError, requestPasswordReset, resetPassword } from '../../lib/auth-api.ts';
import { AuthErrorNotice } from './auth-notice.tsx';
import { authErrorKey } from './error-map.ts';
import { takeUrlToken } from './url-token.ts';
import { useCountdown } from './use-countdown.ts';

const MIN = CONFIG_DEFAULTS['auth.passwordMinLength'];

export function ResetPasswordScreen() {
  const t = useTranslations('auth.reset');
  const tl = useTranslations('auth.login');
  const te = useTranslations('auth.register.errors');
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [neutral, setNeutral] = useState(false);
  const [error, setError] = useState<AuthApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const wait = useCountdown();
  const read = useRef(false);

  useEffect(() => {
    if (read.current) return;
    read.current = true;
    setToken(takeUrlToken());
  }, []);

  async function request(e: React.FormEvent) {
    e.preventDefault();
    if (busy || wait.left > 0) return;
    setError(null);
    const normalized = normalizeEmail(email);
    if (normalized === null) {
      setFieldError(te('email'));
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await requestPasswordReset({ email: normalized, redirectTo: '/sifre-sifirla' });
      setNeutral(true);
    } catch (err) {
      if (
        err instanceof AuthApiError &&
        (err.status === 429 || err.status === 0 || err.status >= 500)
      ) {
        if (err.retryAfterSec) wait.start(err.retryAfterSec);
        setError(err);
      } else setNeutral(true);
    } finally {
      setBusy(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || token === null) return;
    setError(null);
    if (password.length < MIN) {
      setFieldError(te('password', { min: MIN }));
      return;
    }
    if (password !== confirm) {
      setFieldError(t('mismatch'));
      return;
    }
    setFieldError(null);
    setBusy(true);
    try {
      await resetPassword({ newPassword: password, token });
      router.replace('/giris?neden=parola-guncellendi');
    } catch (err) {
      const apiErr =
        err instanceof AuthApiError
          ? err
          : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' });
      if (apiErr.retryAfterSec) wait.start(apiErr.retryAfterSec);
      setError(apiErr);
    } finally {
      setBusy(false);
    }
  }

  if (token !== null) {
    const invalid = error && authErrorKey(error) === 'invalidLink';
    return (
      <form noValidate onSubmit={save} className="flex flex-col gap-5" aria-busy={busy}>
        <h1 className="font-display text-heading-lg text-fg">{t('newTitle')}</h1>
        {invalid ? (
          <div className="flex flex-col gap-3">
            <NoticeBanner tone="danger" role="alert">
              {t('invalid')}
            </NoticeBanner>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.replace('/sifre-sifirla')}
            >
              {t('requestNew')}
            </Button>
          </div>
        ) : (
          <>
            {error && <AuthErrorNotice error={error} waitLeft={wait.left} />}
            <Field label={t('newPassword')} description={te('password', { min: MIN })}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                labels={{ show: tl('showPassword'), hide: tl('hidePassword') }}
              />
            </Field>
            <Field label={t('confirm')} {...(fieldError ? { error: fieldError } : {})}>
              <PasswordInput
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                labels={{ show: tl('showPassword'), hide: tl('hidePassword') }}
              />
            </Field>
            <Button type="submit" loading={busy} loadingLabel={t('saving')}>
              {t('save')}
            </Button>
          </>
        )}
      </form>
    );
  }
  return (
    <form noValidate onSubmit={request} className="flex flex-col gap-5" aria-busy={busy}>
      <div>
        <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">{t('intro')}</p>
      </div>
      {error && <AuthErrorNotice error={error} waitLeft={wait.left} />}
      {neutral && (
        <NoticeBanner tone="info" role="status">
          {t('neutral')}
        </NoticeBanner>
      )}
      <Field label={t('email')} {...(fieldError ? { error: fieldError } : {})}>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          inputMode="email"
        />
      </Field>
      <Button type="submit" loading={busy} loadingLabel={t('submitting')} disabled={wait.left > 0}>
        {t('submit')}
      </Button>
      <Link
        href="/giris"
        className="text-center text-body-sm text-fg-muted underline underline-offset-4 hover:text-fg focus-visible:focus-ring"
      >
        {t('backToLogin')}
      </Link>
    </form>
  );
}
