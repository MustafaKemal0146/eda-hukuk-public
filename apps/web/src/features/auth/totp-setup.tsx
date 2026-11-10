'use client';
// TOTP kurulumu (053-01 §4.2): 1) uygulamayı yükle (+ parola) -> 2) QR veya elle anahtar ->
// 3) 6 haneli kod -> yedek kodlar (bir kez, yalnız bellekte; localStorage/sessionStorage/URL'ye
// yazılmaz) -> onay kutusuyla "Bitir". Dış bağlantı, mağaza düğmesi ve görsel yoktur (yalnız metin).
import { Button, Checkbox, Field, Input, NoticeBanner, PasswordInput } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { AuthApiError, enableTotp, verifyTotp } from '../../lib/auth-api.ts';
import { AuthErrorNotice } from './auth-notice.tsx';
import { QrCode } from './qr-code.tsx';
import { SetupSteps } from './two-factor-steps.tsx';

export type Stage = 'install' | 'scan' | 'code' | 'backup';

export const SETUP_APPS = ['google', 'microsoft', 'authy', 'onepassword', 'bitwarden'] as const;

export function secretOf(uri: string): string {
  try {
    return new URL(uri).searchParams.get('secret') ?? '';
  } catch {
    return '';
  }
}

export const group4 = (s: string): string => s.replace(/(.{4})/g, '$1 ').trim();

/** Yalnız rakam, en çok 6 hane (boşluk, tire ve yapıştırılan diğer karakterler ayıklanır). */
export const sanitizeCode = (raw: string): string => raw.replace(/\D/g, '').slice(0, 6);

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

type Initial = { stage?: Stage; uri?: string; codes?: string[] };

export function TotpSetup({ onDone, initial }: { onDone: () => void; initial?: Initial }) {
  const t = useTranslations('auth.twoFactor');
  const tl = useTranslations('auth.login');
  const [stage, setStage] = useState<Stage>(initial?.stage ?? 'install');
  const [password, setPassword] = useState('');
  const [uri, setUri] = useState(initial?.uri ?? '');
  const [codes, setCodes] = useState<string[]>(initial?.codes ?? []);
  const [code, setCode] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthApiError | null>(null);
  const [wrongCode, setWrongCode] = useState(false);
  const [copied, setCopied] = useState<'' | 'codes' | 'key' | 'failed'>('');
  const secret = secretOf(uri);

  const fail = (e: unknown) =>
    setError(
      e instanceof AuthApiError
        ? e
        : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' }),
    );

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await enableTotp(password);
      setUri(r.totpURI);
      setCodes(r.backupCodes);
      setPassword('');
      setStage('scan');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setWrongCode(false);
    setBusy(true);
    try {
      await verifyTotp(code.trim());
      setStage('backup');
    } catch (err) {
      if (err instanceof AuthApiError && (err.status === 400 || err.status === 401)) {
        setWrongCode(true);
        setCode('');
      } else {
        fail(err);
      }
    } finally {
      setBusy(false);
    }
  }

  async function copy(what: 'codes' | 'key') {
    const ok = await copyText(what === 'codes' ? codes.join('\n') : secret);
    setCopied(ok ? what : 'failed');
  }

  function download() {
    const blob = new Blob([`${codes.join('\n')}\n`], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eda-yedek-kodlar.txt';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const copyStatus =
    copied === 'key'
      ? t('setup.keyCopied')
      : copied === 'codes'
        ? t('setup.copied')
        : copied === 'failed'
          ? t('setup.copyFailed')
          : '';
  const stepOf = stage === 'backup' ? 'done' : stage;

  return (
    <div className="flex flex-col gap-5">
      <SetupSteps current={stepOf} />
      {error && <AuthErrorNotice error={error} />}
      {wrongCode && (
        <NoticeBanner tone="danger" role="alert">
          {t('setup.codeWrong')}
        </NoticeBanner>
      )}
      {stage === 'install' && (
        <form onSubmit={start} className="flex flex-col gap-5" noValidate>
          <section className="flex flex-col gap-3" aria-labelledby="setup-install">
            <h2 id="setup-install" className="text-title text-fg">
              {t('setup.installTitle')}
            </h2>
            <p className="text-body-sm text-fg-muted">{t('setup.installBody')}</p>
            <ul aria-label={t('setup.appsLabel')} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SETUP_APPS.map((key) => (
                <li
                  key={key}
                  className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-body-sm font-medium text-fg"
                >
                  {t(`setup.apps.${key}`)}
                </li>
              ))}
            </ul>
            <p className="text-body-sm text-fg-muted">{t('setup.installStore')}</p>
            <p className="text-body-sm text-fg-muted">{t('setup.alreadyHave')}</p>
          </section>
          <section className="flex flex-col gap-4 border-t border-border pt-5">
            <h2 className="text-title text-fg">{t('setup.passwordStepTitle')}</h2>
            <Field label={t('setup.passwordLabel')} description={t('setup.passwordHelp')}>
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                labels={{ show: tl('showPassword'), hide: tl('hidePassword') }}
              />
            </Field>
            <Button type="submit" loading={busy} disabled={password === ''}>
              {t('setup.start')}
            </Button>
          </section>
        </form>
      )}
      {stage === 'scan' && (
        <div className="flex flex-col gap-5">
          <h2 className="text-title text-fg">{t('setup.qrStepTitle')}</h2>
          <p className="text-body-sm text-fg-muted">{t('setup.qrSteps')}</p>
          <div className="flex justify-center">
            <QrCode value={uri} label={t('setup.qrLabel')} />
          </div>
          <p className="rounded-md bg-surface-sunken p-3 text-body-sm text-fg-muted">
            {t('setup.sameDevice')}
          </p>
          <section className="flex flex-col gap-2 rounded-md border border-border p-4">
            <h3 className="text-body font-semibold text-fg">{t('setup.manualTitle')}</h3>
            <p className="text-body-sm text-fg-muted">{t('setup.manualKey')}</p>
            <p className="text-caption text-fg-subtle">{t('setup.manualKeyLabel')}</p>
            <p
              data-testid="manual-key"
              className="select-all break-all rounded-md border border-border bg-surface-sunken px-3 py-2 font-mono text-code text-fg"
            >
              {group4(secret)}
            </p>
            <p className="text-caption text-fg-subtle">{t('setup.keyType')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => void copy('key')}
            >
              {t('setup.copyKey')}
            </Button>
          </section>
          <Button
            type="button"
            onClick={() => {
              setCopied('');
              setStage('code');
            }}
          >
            {t('setup.next')}
          </Button>
        </div>
      )}
      {stage === 'code' && (
        <form onSubmit={confirm} className="flex flex-col gap-5" noValidate>
          <h2 className="text-title text-fg">{t('setup.codeStepTitle')}</h2>
          <p className="text-body-sm text-fg-muted">{t('setup.codeStepBody')}</p>
          <Field label={t('codeLabel')} description={t('setup.codeHelp')}>
            <Input
              value={code}
              onChange={(e) => setCode(sanitizeCode(e.target.value))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              autoFocus
            />
          </Field>
          <p className="text-body-sm text-fg-muted">{t('setup.codeRefresh')}</p>
          <p className="text-body-sm text-fg-muted">{t('setup.clockHelp')}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setCopied('');
                setStage('scan');
              }}
            >
              {t('setup.back')}
            </Button>
            <Button type="submit" loading={busy} disabled={code.length !== 6}>
              {t('setup.confirm')}
            </Button>
          </div>
        </form>
      )}
      {stage === 'backup' && (
        <div className="flex flex-col gap-5">
          <h2 className="text-title text-fg">{t('setup.backupTitle')}</h2>
          <p className="text-body-sm text-fg-muted">{t('setup.backupIntro')}</p>
          <NoticeBanner tone="warning" role="note">
            {t('setup.backupWarning')}
          </NoticeBanner>
          <ul className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface-sunken p-3 font-mono text-code text-fg">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copy('codes')}>
              {t('setup.copy')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={download}>
              {t('setup.download')}
            </Button>
          </div>
          <Checkbox checked={ack} onCheckedChange={setAck} label={t('setup.ack')} />
          <Button
            type="button"
            disabled={!ack}
            onClick={() => {
              setCodes([]);
              onDone();
            }}
          >
            {t('setup.finish')}
          </Button>
        </div>
      )}
      <p role="status" aria-live="polite" className="min-h-5 text-body-sm text-fg-muted">
        {copyStatus}
      </p>
    </div>
  );
}
