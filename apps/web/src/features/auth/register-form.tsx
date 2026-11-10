'use client';
// Kayıt adım 1 (042 §3.1; 053-01 §5): ad, e-posta, parola ve iki AYRI işaretsiz onay. Meslek bilgisi
// e-posta doğrulamasından sonra `/kayit?adim=meslek` ile alınır. Var olan e-posta ile kayıt
// başarı ekranıyla aynı sonucu verir (hesap varlığı sızdırılmaz).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { isAsciiEmail, normalizeEmail } from '@eda/legal/text';
import { Button, Checkbox, Field, Input, PasswordInput } from '@eda/ui';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { AuthApiError, sendVerificationEmail, signUpEmail } from '../../lib/auth-api.ts';
import { AuthErrorNotice } from './auth-notice.tsx';
import { useCountdown } from './use-countdown.ts';

const MIN = CONFIG_DEFAULTS['auth.passwordMinLength'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldErrors = Partial<Record<'name' | 'email' | 'password' | 'terms' | 'privacy', string>>;

function RegisterSuccess({ email }: { email: string }) {
  const t = useTranslations('auth.register.success');
  const wait = useCountdown();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AuthApiError | null>(null);
  async function resend() {
    setError(null);
    try {
      await sendVerificationEmail({ email, callbackURL: '/eposta-dogrulama?durum=basarili' });
      setSent(true);
      wait.start(CONFIG_DEFAULTS['ui.resendCooldownSec']);
    } catch (e) {
      if (e instanceof AuthApiError) {
        if (e.retryAfterSec) wait.start(e.retryAfterSec);
        setError(e);
      }
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">{t('body', { email })}</p>
      </div>
      <ol className="flex list-decimal flex-col gap-2 pl-5 text-body-sm text-fg">
        <li>{t('step1')}</li>
        <li>{t('step2', { n: CONFIG_DEFAULTS['auth.verificationSlaBusinessHours'] })}</li>
        <li>{t('step3')}</li>
      </ol>
      <p className="text-body-sm text-fg-muted">{t('note')}</p>
      {error && <AuthErrorNotice error={error} waitLeft={wait.left} />}
      <Button
        type="button"
        variant="outline"
        disabled={wait.left > 0}
        onClick={() => void resend()}
      >
        {wait.left > 0 ? t('resendWait', { n: wait.left }) : t('resend')}
      </Button>
      {sent && wait.left > 0 && (
        <p role="status" className="text-body-sm text-fg-muted">
          {t('resent')}
        </p>
      )}
      <p className="text-caption text-fg-subtle">{t('spam')}</p>
    </div>
  );
}

export function RegisterForm() {
  const t = useTranslations('auth.register');
  const te = useTranslations('auth.register.errors');
  const tl = useTranslations('auth.login');
  const tg = useTranslations('legal.signup');
  const router = useRouter();
  const params = useSearchParams();
  const invite = params.get('davet');
  const inviteToken = invite !== null && UUID.test(invite) ? invite : null;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [terms, setTerms] = useState(false);
  const [privacy, setPrivacy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [apiError, setApiError] = useState<AuthApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const wait = useCountdown();
  const summary = useRef<HTMLDivElement>(null);

  function validate(): { ok: true; email: string } | { ok: false } {
    const e: FieldErrors = {};
    if (name.trim().length < 2) e.name = te('name');
    const normalized = normalizeEmail(email);
    if (normalized === null) {
      e.email = /[^\x21-\x7E]/.test(email) ? te('emailAscii') : te('email');
    } else if (!isAsciiEmail(normalized)) e.email = te('emailAscii');
    if (password.length < MIN) e.password = te('password', { min: MIN });
    if (!terms) e.terms = te('required');
    if (!privacy) e.privacy = te('required');
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setTimeout(() => summary.current?.focus(), 0);
      return { ok: false };
    }
    return { ok: true, email: normalized ?? email };
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || wait.left > 0) return;
    setApiError(null);
    const v = validate();
    if (!v.ok) return;
    setBusy(true);
    try {
      await signUpEmail({
        name: name.trim(),
        email: v.email,
        password,
        acceptTerms: true,
        acknowledgePrivacy: true,
        ...(inviteToken
          ? { invitationToken: inviteToken, callbackURL: `/davet/${inviteToken}` }
          : { callbackURL: '/eposta-dogrulama?durum=basarili' }),
      });
      if (inviteToken) router.replace(`/davet/${inviteToken}`);
      else setDone(v.email);
    } catch (err) {
      const e =
        err instanceof AuthApiError
          ? err
          : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' });
      if (e.retryAfterSec) wait.start(e.retryAfterSec);
      setApiError(e);
      setTimeout(() => summary.current?.focus(), 0);
    } finally {
      setBusy(false);
    }
  }

  if (done) return <RegisterSuccess email={done} />;

  const items = Object.values(errors).filter(Boolean) as string[];
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-heading-lg text-fg">
          {inviteToken ? t('inviteTitle') : t('title')}
        </h1>
        <p className="mt-2 text-body-sm text-fg-muted">
          {inviteToken ? t('inviteSubtitle') : t('subtitle')}
        </p>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-col gap-5" aria-busy={busy}>
        <div ref={summary} tabIndex={-1} className="flex flex-col gap-3 focus-visible:focus-ring">
          {apiError && <AuthErrorNotice error={apiError} waitLeft={wait.left} />}
          {items.length > 0 && (
            <ul role="alert" className="list-disc pl-5 text-body-sm text-danger">
              {items.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </div>
        <Field label={t('name')} {...(errors.name ? { error: errors.name } : {})}>
          <Input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
          />
        </Field>
        <Field label={t('email')} {...(errors.email ? { error: errors.email } : {})}>
          <Input
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
          />
        </Field>
        <Field
          label={t('password')}
          description={t('passwordHelp', { min: MIN })}
          {...(errors.password ? { error: errors.password } : {})}
        >
          <PasswordInput
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            labels={{ show: tl('showPassword'), hide: tl('hidePassword') }}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Checkbox checked={terms} onCheckedChange={setTerms} label={t('terms')} />
          <a
            href="/kullanim-kosullari"
            target="_blank"
            rel="noopener"
            className="pl-6 text-caption text-primary underline underline-offset-4 focus-visible:focus-ring"
          >
            {tg('termsLink')}
          </a>
          <p className="pl-6 text-caption text-fg-muted">{t('pilotNote')}</p>
          {errors.terms && <p className="text-body-sm text-danger">{errors.terms}</p>}
        </div>
        <div className="flex flex-col gap-1.5">
          <Checkbox checked={privacy} onCheckedChange={setPrivacy} label={t('privacy')} />
          <p className="pl-6 text-caption text-fg-subtle">{t('privacyHelp')}</p>
          <a
            href="/kvkk-aydinlatma"
            target="_blank"
            rel="noopener"
            className="pl-6 text-caption text-primary underline underline-offset-4 focus-visible:focus-ring"
          >
            {tg('kvkkLink')}
          </a>
          {errors.privacy && <p className="text-body-sm text-danger">{errors.privacy}</p>}
        </div>
        <Button type="submit" fullWidth loading={busy} loadingLabel={t('submitting')}>
          {t('submit')}
        </Button>
        <p className="border-t border-border pt-5 text-center text-body-sm text-fg-muted">
          {t('haveAccount')}{' '}
          <Link
            href="/giris"
            className="font-medium text-fg underline underline-offset-4 hover:text-fg-muted focus-visible:focus-ring"
          >
            {t('login')}
          </Link>
        </p>
      </form>
    </div>
  );
}
