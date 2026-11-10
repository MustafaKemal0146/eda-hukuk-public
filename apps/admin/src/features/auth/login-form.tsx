'use client';
// Yönetim girişi: e-posta + parola, ardından TOTP kodu (2 adımlı doğrulama); geçiş anahtarı (passkey)
// ikincil seçenektir. `#kayit=<belirteç>` ile açılırsa ilk passkey KAYDI yapılır: belirteç hemen alınır
// ve adres çubuğundan temizlenir (`history.replaceState`). "Hatırla" yoktur. Hata iletileri ayrışık ipucu
// vermez (hesabın varlığı sızmaz). Tarayıcı desteği ilk işlemede bilinmez (hidrasyon uyuşmazlığı olmasın):
// `useEffect` içinde belirlenir. Odak: adım değişince ilk alana, hata olunca hata iletisine.
import { Button, Field, Input, NoticeBanner, PasswordInput } from '@eda/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { resetSessionGuard } from '../../lib/session-guard.ts';
import {
  type AuthenticationOptionsJSON,
  createCredential,
  getCredential,
  type RegistrationOptionsJSON,
  webauthnSupported,
} from '../../lib/webauthn.ts';
import {
  classifyPasswordFailure,
  classifyTotpFailure,
  INITIAL_WEBAUTHN_SUPPORT,
  isEmailPlausible,
  isTotpCodeComplete,
  type LoginErrorKey,
  type LoginStep,
  needsTotp,
  normalizeTotpCode,
  trimLoginEmail,
} from './login-model.ts';

type Mode = 'login' | 'enroll';
type Phase = 'idle' | 'working' | 'done';

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/auth${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

async function errorCode(res: Response): Promise<string | null> {
  try {
    const j = (await res.json()) as { code?: unknown };
    return typeof j.code === 'string' ? j.code : null;
  } catch {
    return null;
  }
}

export function LoginForm({ sessionEnded = false }: { sessionEnded?: boolean }) {
  const t = useTranslations('login');
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<LoginStep>('credentials');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<LoginErrorKey | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [notice, setNotice] = useState<'enrolled' | null>(null);
  const [supported, setSupported] = useState<boolean | null>(INITIAL_WEBAUTHN_SUPPORT);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const token = useRef<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    // Giriş sayfası açıldı: önceki oturumdan kalan 401 kapısı açılır (yeni oturum istek atabilsin).
    resetSessionGuard();
    setSupported(webauthnSupported());
    const m = /^#kayit=([A-Za-z0-9_-]{20,200})$/.exec(window.location.hash);
    if (m?.[1]) {
      token.current = m[1];
      setMode('enroll');
      // Belirteç adres çubuğunda ve geçmişte kalmasın.
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);

  useEffect(() => {
    if (step === 'totp') codeRef.current?.focus();
    else if (mode === 'login') emailRef.current?.focus();
  }, [step, mode]);

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);

  const fail = (key: LoginErrorKey, wait: number | null = null) => {
    setPhase('idle');
    setRetryAfter(wait);
    setError(key);
  };

  async function enroll() {
    if (token.current === null) return;
    const start = await api('/staff/enroll', {
      method: 'POST',
      body: JSON.stringify({ token: token.current }),
    });
    if (!start.ok) throw new Error('enroll');
    token.current = null;
    const optRes = await api('/passkey/generate-register-options');
    if (!optRes.ok) throw new Error('options');
    const options = (await optRes.json()) as RegistrationOptionsJSON;
    const response = await createCredential(options);
    const done = await api('/passkey/verify-registration', {
      method: 'POST',
      body: JSON.stringify({ response }),
    });
    if (!done.ok) throw new Error('verify');
    setMode('login');
    setNotice('enrolled');
  }

  async function passkeyLogin() {
    const optRes = await api('/passkey/generate-authenticate-options');
    if (!optRes.ok) throw new Error('options');
    const options = (await optRes.json()) as AuthenticationOptionsJSON;
    const response = await getCredential(options);
    const res = await api('/passkey/verify-authentication', {
      method: 'POST',
      body: JSON.stringify({ response }),
    });
    if (!res.ok) throw new Error('verify');
    setPhase('done');
    router.replace('/');
    router.refresh();
  }

  async function runPasskey() {
    setPhase('working');
    setError(null);
    setNotice(null);
    try {
      if (mode === 'enroll') await enroll();
      else await passkeyLogin();
      if (mode === 'enroll') setPhase('idle');
    } catch {
      fail(mode === 'enroll' ? 'enrollFailed' : 'passkeyFailed');
    }
  }

  async function submitCredentials(e: FormEvent) {
    e.preventDefault();
    if (phase === 'working') return;
    setError(null);
    setNotice(null);
    if (!isEmailPlausible(email) || password === '') {
      fail('invalidCredentials');
      return;
    }
    setPhase('working');
    try {
      const res = await api('/sign-in/email', {
        method: 'POST',
        body: JSON.stringify({ email: trimLoginEmail(email), password }),
      });
      if (!res.ok) {
        const f = classifyPasswordFailure(res.status, res.headers.get('retry-after'));
        fail(f.key, f.retryAfterSec);
        return;
      }
      if (!needsTotp(await res.json().catch(() => null))) {
        fail('invalidCredentials');
        return;
      }
      setPassword('');
      setCode('');
      setStep('totp');
      setPhase('idle');
    } catch {
      fail('generic');
    }
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    if (phase === 'working') return;
    setError(null);
    if (!isTotpCodeComplete(code)) {
      fail('invalidCode');
      return;
    }
    setPhase('working');
    try {
      const res = await api('/two-factor/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        const f = classifyTotpFailure(
          res.status,
          await errorCode(res),
          res.headers.get('retry-after'),
        );
        if (f.key === 'challengeExpired') setStep('credentials');
        setCode('');
        fail(f.key, f.retryAfterSec);
        return;
      }
      setPhase('done');
      router.replace('/');
      router.refresh();
    } catch {
      fail('generic');
    }
  }

  const busy = phase === 'working' || phase === 'done';
  const errorText =
    error === null
      ? null
      : error === 'rateLimited'
        ? retryAfter === null
          ? t('errors.rateLimited')
          : t('errors.rateLimitedWait', { seconds: retryAfter })
        : t(`errors.${error}`);

  const errorBlock = errorText !== null && (
    <p ref={errorRef} tabIndex={-1} role="alert" className="text-body-sm text-danger outline-none">
      {errorText}
    </p>
  );

  if (mode === 'enroll') {
    if (supported === false) {
      return (
        <NoticeBanner tone="danger" role="alert">
          {t('unsupported')}
        </NoticeBanner>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <NoticeBanner tone="info" role="status" title={t('enrollTitle')}>
          {t('enrollBody')}
        </NoticeBanner>
        <Button
          fullWidth
          leadingIcon="control.locked"
          loading={phase === 'working'}
          loadingLabel={t('working')}
          disabled={supported === null}
          onClick={() => void runPasskey()}
        >
          {t('enrollAction')}
        </Button>
        {errorBlock}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite">
        {sessionEnded && notice === null && error === null && (
          <NoticeBanner tone="info" role="status">
            {t('sessionEnded')}
          </NoticeBanner>
        )}
        {notice === 'enrolled' && (
          <NoticeBanner tone="success" role="status">
            {t('enrolled')}
          </NoticeBanner>
        )}
      </div>
      {step === 'credentials' ? (
        <form
          onSubmit={(e) => void submitCredentials(e)}
          className="flex flex-col gap-4"
          noValidate
        >
          <Field label={t('emailLabel')}>
            <Input
              ref={emailRef}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              inputMode="email"
              spellCheck={false}
            />
          </Field>
          <Field label={t('passwordLabel')}>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              labels={{ show: t('showPassword'), hide: t('hidePassword') }}
            />
          </Field>
          {errorBlock}
          <Button type="submit" fullWidth loading={phase === 'working'} loadingLabel={t('working')}>
            {t('continue')}
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => void submitCode(e)} className="flex flex-col gap-4" noValidate>
          <p className="text-body-sm text-fg-muted">{t('codeIntro')}</p>
          <Field label={t('codeLabel')} description={t('codeHelp')}>
            <Input
              ref={codeRef}
              value={code}
              onChange={(e) => setCode(normalizeTotpCode(e.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
            />
          </Field>
          {errorBlock}
          <Button
            type="submit"
            fullWidth
            loading={phase === 'working'}
            loadingLabel={t('working')}
            disabled={!isTotpCodeComplete(code)}
          >
            {t('verify')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            fullWidth
            disabled={busy}
            onClick={() => {
              setStep('credentials');
              setCode('');
              setError(null);
            }}
          >
            {t('back')}
          </Button>
        </form>
      )}
      {step === 'credentials' && supported === true && (
        <>
          <div className="flex items-center gap-3 text-caption text-fg-subtle" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />
            {t('or')}
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button
            type="button"
            variant="outline"
            fullWidth
            leadingIcon="control.locked"
            disabled={busy}
            onClick={() => void runPasskey()}
          >
            {t('passkey')}
          </Button>
        </>
      )}
    </div>
  );
}
