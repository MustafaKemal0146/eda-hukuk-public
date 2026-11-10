'use client';
// Giriş formu (053-01 §3): Better Auth `sign-in/email`; iki adımlı doğrulama gerekiyorsa `/iki-adimli`.
// Hata metinleri hesap varlığını sızdırmaz; "hesap kilitlendi" ifadesi yoktur (Y-46).
import { normalizeEmail } from '@eda/legal/text';
import { Button, Checkbox, Field, Input, NoticeBanner, PasswordInput } from '@eda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthApiError, sendVerificationEmail, signInEmail } from '../../lib/auth-api.ts';
import { safeNext } from '../../lib/safe-next.ts';
import { parseLoginReason, resetSessionGuard } from '../../lib/session-guard.ts';
import { AuthErrorNotice } from './auth-notice.tsx';
import { authErrorKey } from './error-map.ts';
import { useCountdown } from './use-countdown.ts';

export function LoginForm() {
  const t = useTranslations('auth.login');
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('sonraki'));
  const reason = parseLoginReason(params.get('neden'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthApiError | null>(null);
  const [resent, setResent] = useState(false);
  const wait = useCountdown();
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Giriş formu açıldı: önceki oturumdan kalan 401 kapısı açılır (yeni oturum istek atabilsin).
    resetSessionGuard();
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || wait.left > 0) return;
    setError(null);
    setResent(false);
    const normalized = normalizeEmail(email);
    if (normalized === null || password === '') {
      setError(new AuthApiError({ status: 401, code: 'INVALID_EMAIL_OR_PASSWORD', message: '' }));
      return;
    }
    setBusy(true);
    try {
      const r = await signInEmail({ email: normalized, password, rememberMe: remember });
      if (r.kind === 'two_factor') {
        router.replace(`/iki-adimli?sonraki=${encodeURIComponent(next)}`);
      } else {
        router.replace(next);
        router.refresh();
      }
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

  async function resend() {
    const normalized = normalizeEmail(email);
    if (normalized === null) return;
    try {
      await sendVerificationEmail({
        email: normalized,
        callbackURL: '/eposta-dogrulama?durum=basarili',
      });
    } catch {
      // Yanıt nötrdür; hata ayrımı gösterilmez.
    }
    setResent(true);
  }

  const key = error ? authErrorKey(error) : null;
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy}>
      {reason && !error && (
        <NoticeBanner tone="info" role="status">
          {t(`reasons.${reason}`)}
        </NoticeBanner>
      )}
      {error && <AuthErrorNotice error={error} waitLeft={wait.left} focusRef={errorRef} />}
      {key === 'emailNotVerified' && (
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" onClick={() => void resend()}>
            {t('resend')}
          </Button>
          {resent && (
            <p role="status" className="text-body-sm text-fg-muted">
              {t('resent')}
            </p>
          )}
        </div>
      )}
      <Field label={t('email')}>
        <Input
          type="email"
          name="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username webauthn"
          inputMode="email"
          placeholder={t('emailPlaceholder')}
        />
      </Field>
      <Field
        label={t('password')}
        labelAside={
          <Link
            href="/sifre-sifirla"
            className="text-caption text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:focus-ring"
          >
            {t('forgot')}
          </Link>
        }
      >
        <PasswordInput
          name="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          labels={{ show: t('showPassword'), hide: t('hidePassword') }}
        />
      </Field>
      <Checkbox checked={remember} onCheckedChange={setRemember} label={t('remember')} />
      <Button type="submit" fullWidth loading={busy} loadingLabel={t('submitting')}>
        {wait.left > 0 ? t('retryIn', { n: wait.left }) : t('submit')}
      </Button>
      <p className="border-t border-border pt-5 text-center text-body-sm text-fg-muted">
        {t('noAccount')}{' '}
        <Link
          href="/kayit"
          className="font-medium text-fg underline underline-offset-4 hover:text-fg-muted focus-visible:focus-ring"
        >
          {t('apply')}
        </Link>
      </p>
    </form>
  );
}
