'use client';
// Büro/kullanıcı anahtar atama ve silme pencereleri. Yapay zekâ sayfasındaki liste ve
// Kullanıcılar ayrıntısındaki "API anahtarı" bölümü aynı pencereleri kullanır. Anahtar alanı password
// türündedir, kayıttan hemen sonra temizlenir ve hiçbir yerde saklanmaz; yanıtlar anahtar taşımaz.
// Yeniden doğrulama (step-up) çağıranın `run` işleviyle yapılır.
import { AlertDialog, Button, Dialog, Field, Input } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { AdminApiError, adminFetch } from '../../lib/admin-api.ts';
import {
  isKeyInputValid,
  type KeyErrorKey,
  type KeyItem,
  keyErrorKey,
  keyPath,
  targetLabel,
} from './ai-keys-model.ts';

export type StepUpRun = <T>(fn: () => Promise<T>) => Promise<T>;

interface Props {
  readonly target: KeyItem | null;
  readonly run: StepUpRun;
  readonly onClose: () => void;
  /** İşlem başarılı oldu (liste/durum yenilensin). */
  readonly onApplied: () => void | Promise<void>;
}

export function KeyAssignDialog({ target, run, onClose, onApplied }: Props) {
  const t = useTranslations('ai.keys');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KeyErrorKey | null>(null);

  function close() {
    setSecret('');
    setError(null);
    onClose();
  }

  async function submit() {
    if (target === null || busy || !isKeyInputValid(secret)) return;
    setBusy(true);
    setError(null);
    try {
      await run(() =>
        adminFetch(keyPath(target), { method: 'PUT', body: { apiKey: secret.trim() } }),
      );
      // Anahtar alanı hemen temizlenir; başarıdan sonra hiçbir yerde tutulmaz.
      setSecret('');
      onClose();
      await onApplied();
    } catch (e) {
      const api = e instanceof AdminApiError ? e : null;
      setError(keyErrorKey(api?.code, api?.status));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title={t('dialog.title')}
      description={target ? t('dialog.description', { target: targetLabel(target) }) : undefined}
      size="sm"
      labels={{ close: t('dialog.cancel') }}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={close}>
            {t('dialog.cancel')}
          </Button>
          <Button
            type="submit"
            form="ai-key-assign"
            loading={busy}
            loadingLabel={t('dialog.working')}
            disabled={!isKeyInputValid(secret)}
          >
            {t('dialog.submit')}
          </Button>
        </>
      }
    >
      <form
        id="ai-key-assign"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
        noValidate
      >
        <Field
          label={t('dialog.field')}
          description={t('dialog.hint')}
          {...(secret !== '' && !isKeyInputValid(secret) ? { error: t('dialog.invalid') } : {})}
        >
          <Input
            type="password"
            name="ai-api-key"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={400}
            autoFocus
          />
        </Field>
        <p className="text-caption text-fg-subtle">
          {target?.kind === 'user' ? t('dialog.userNote') : t('dialog.orgNote')}
        </p>
        {error !== null && (
          <p role="alert" className="text-body-sm text-danger">
            {t(`error.${error}`)}
          </p>
        )}
      </form>
    </Dialog>
  );
}

export function KeyRemoveDialog({ target, run, onClose, onApplied }: Props) {
  const t = useTranslations('ai.keys');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<KeyErrorKey | null>(null);

  async function confirm() {
    if (target === null) return;
    setBusy(true);
    setError(null);
    try {
      await run(() => adminFetch(keyPath(target), { method: 'DELETE' }));
      onClose();
      await onApplied();
    } catch (e) {
      const api = e instanceof AdminApiError ? e : null;
      setError(keyErrorKey(api?.code, api?.status));
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AlertDialog
        open={target !== null}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={t('removeDialog.title')}
        description={target ? t('removeDialog.body', { target: targetLabel(target) }) : undefined}
        impact={t('removeDialog.impact')}
        cancelLabel={t('dialog.cancel')}
        destructiveLabel={t('removeDialog.confirm')}
        tone="danger"
        confirmLoading={busy}
        confirmLoadingLabel={t('dialog.working')}
        onConfirm={() => void confirm()}
      />
      {error !== null && (
        <p role="alert" className="text-body-sm text-danger">
          {t(`error.${error}`)}
        </p>
      )}
    </>
  );
}
