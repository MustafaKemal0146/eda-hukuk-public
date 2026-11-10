'use client';
// Step-up kancası: işlem `AUTH_STEP_UP_REQUIRED` verirse "kimliğinizi doğrulayın" penceresi açılır.
// Yöntem oturumun açılışına göre seçilir: geçiş anahtarı oturumunda passkey (istem yalnız düğmeyle),
// parola+TOTP oturumunda 6 haneli kod. Doğrulayınca işlem bir kez yeniden denenir.
import { AlertDialog, Button, Dialog, Field, Input } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useRef, useState } from 'react';
import {
  currentStepUpMethod,
  isStepUp,
  stepUpWithPasskey,
  stepUpWithTotp,
} from '../lib/admin-api.ts';

type Method = 'passkey' | 'totp';

export function useStepUp(): {
  run: <T>(fn: () => Promise<T>) => Promise<T>;
  dialog: ReactNode;
} {
  const t = useTranslations('stepUp');
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>('passkey');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState('');
  const waiter = useRef<{ ok: () => void; cancel: () => void } | null>(null);

  const ask = useCallback(async () => {
    const m = await currentStepUpMethod().catch((): Method => 'passkey');
    setMethod(m);
    return new Promise<void>((resolve, reject) => {
      waiter.current = { ok: resolve, cancel: () => reject(new Error('cancelled')) };
      setFailed(false);
      setCode('');
      setOpen(true);
    });
  }, []);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (e) {
        if (!isStepUp(e)) throw e;
        await ask();
        return fn();
      }
    },
    [ask],
  );

  const close = (o: boolean) => {
    if (!o) {
      setOpen(false);
      waiter.current?.cancel();
      waiter.current = null;
    }
  };

  const verify = async () => {
    setBusy(true);
    try {
      if (method === 'totp') await stepUpWithTotp(code);
      else await stepUpWithPasskey();
      setOpen(false);
      waiter.current?.ok();
      waiter.current = null;
    } catch {
      setFailed(true);
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const dialog =
    method === 'totp' ? (
      <Dialog
        open={open}
        onOpenChange={close}
        title={t('title')}
        description={t('bodyTotp')}
        size="sm"
        labels={{ close: t('cancel') }}
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              {t('cancel')}
            </Button>
            <Button
              type="submit"
              form="step-up-totp"
              loading={busy}
              loadingLabel={t('working')}
              disabled={!/^\d{6}$/.test(code)}
            >
              {t('confirm')}
            </Button>
          </>
        }
      >
        <form
          id="step-up-totp"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!busy) void verify();
          }}
          className="flex flex-col gap-3"
          noValidate
        >
          <Field label={t('codeLabel')} {...(failed ? { error: t('failedCode') } : {})}>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              autoFocus
            />
          </Field>
        </form>
      </Dialog>
    ) : (
      <AlertDialog
        open={open}
        onOpenChange={close}
        title={t('title')}
        description={failed ? t('failed') : t('bodyPasskey')}
        cancelLabel={t('cancel')}
        destructiveLabel={t('confirm')}
        confirmLoading={busy}
        confirmLoadingLabel={t('working')}
        onConfirm={() => void verify()}
      />
    );
  return { run, dialog };
}
