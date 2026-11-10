'use client';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
// `/iki-adimli` (053-01 §4): doğrulama kipi (TOTP veya yedek kod) ve kurulum kipi (TOTP).
// Geçiş anahtarı (passkey) bu dilimde yoktur; "Bu cihaza güven" sunulmaz.
import { Button, Field, Input, TabPanel, Tabs } from '@eda/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { AuthApiError, getMe, verifyBackupCode, verifyTotp } from '../../lib/auth-api.ts';
import { safeNext } from '../../lib/safe-next.ts';
import { AuthErrorNotice } from './auth-notice.tsx';
import { TotpSetup } from './totp-setup.tsx';
import { useCountdown } from './use-countdown.ts';

type Method = 'totp' | 'backup';

function VerifyForm({ next }: { next: string }) {
  const t = useTranslations('auth.twoFactor');
  const router = useRouter();
  const [method, setMethod] = useState<Method>('totp');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthApiError | null>(null);
  const wait = useCountdown();
  const [help, setHelp] = useState(false);
  const inFlight = useRef(false);

  async function submit(value: string) {
    if (inFlight.current || wait.left > 0) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      if (method === 'totp') await verifyTotp(value);
      else await verifyBackupCode(value);
      router.replace(next);
      router.refresh();
    } catch (err) {
      const e =
        err instanceof AuthApiError
          ? err
          : new AuthApiError({ status: 0, code: 'CLIENT_NETWORK', message: '' });
      if (e.retryAfterSec) wait.start(e.retryAfterSec);
      setError(
        e.status === 401 || e.status === 400
          ? new AuthApiError({ ...e, status: 401, code: 'INVALID_CODE', message: '' })
          : e,
      );
      setCode('');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // 6. hanede otomatik gönderim (yalnız TOTP).
  useEffect(() => {
    if (method === 'totp' && code.length === 6) void submit(code);
  }, [code]);

  return (
    <div className="flex flex-col gap-5">
      {error && <AuthErrorNotice error={error} waitLeft={wait.left} />}
      <Tabs
        value={method}
        onValueChange={(v) => {
          setMethod(v);
          setCode('');
          setError(null);
        }}
        label={t('title')}
        items={[
          { value: 'totp', label: t('totpTab') },
          { value: 'backup', label: t('backupTab') },
        ]}
      >
        <TabPanel value="totp" className="pt-5">
          <Field label={t('codeLabel')} description={t('codeHelp')}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              autoFocus
            />
          </Field>
        </TabPanel>
        <TabPanel value="backup" className="flex flex-col gap-4 pt-5">
          <Field label={t('backupLabel')} description={t('backupHelp')}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Button
            type="button"
            loading={busy}
            disabled={code.trim() === '' || wait.left > 0}
            onClick={() => void submit(code.trim())}
          >
            {t('verify')}
          </Button>
        </TabPanel>
      </Tabs>
      <button
        type="button"
        aria-expanded={help}
        onClick={() => setHelp((v) => !v)}
        className="w-fit text-body-sm text-fg-muted underline underline-offset-4 hover:text-fg focus-visible:focus-ring"
      >
        {t('cantAccess')}
      </button>
      {help && (
        <p className="rounded-md bg-surface-sunken p-3 text-body-sm text-fg-muted">
          {t('cantAccessBody', { hours: CONFIG_DEFAULTS['auth.mfaResetWaitHours'] })}
        </p>
      )}
    </div>
  );
}

export function TwoFactorScreen() {
  const t = useTranslations('auth.twoFactor');
  const params = useSearchParams();
  const router = useRouter();
  const setup = params.get('mod') === 'kurulum';
  const next = safeNext(params.get('sonraki'));
  const [required, setRequired] = useState<boolean | null>(null);

  useEffect(() => {
    if (!setup) return;
    void getMe()
      .then((m) => setRequired(m.mfaRequired))
      .catch(() => setRequired(false));
  }, [setup]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">
          {setup ? t('subtitleSetup') : t('subtitleVerify')}
        </p>
        {setup && required && (
          <p className="mt-2 text-body-sm text-fg-muted">{t('requiredNotice')}</p>
        )}
      </div>
      {setup ? (
        <>
          <TotpSetup
            onDone={() => {
              router.replace(next);
              router.refresh();
            }}
          />
          {required === false && (
            <Button type="button" variant="ghost" onClick={() => router.replace(next)}>
              {t('setup.later')}
            </Button>
          )}
        </>
      ) : (
        <VerifyForm next={next} />
      )}
    </div>
  );
}
