'use client';
// Yeni dava klasörü penceresi: başlık zorunlu; büro dosya kodu, esas no (YYYY/NNN), görünürlük ve
// açılış tarihi isteğe bağlı. Oluşturma "ilk müvekkil verisi anı"dır: MFA gerekiyorsa çağıran
// kurulum ekranına yönlendirir.
import type { CaseDtoValue } from '@eda/contracts/api/cases';
import { Button, DateField, Dialog, Field, Input, SegmentedControl } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { ApiClientError, documentsApi } from '../studio/documents-api.ts';

const ESAS_RE = /^[0-9]{4}\/[0-9]{1,7}$/;

export function NewCaseDialog({
  open,
  onClose,
  onCreated,
  onAuth,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: CaseDtoValue) => void;
  onAuth: (err: unknown) => boolean;
}) {
  const t = useTranslations('files.newCaseForm');
  const [title, setTitle] = useState('');
  const [code, setCode] = useState('');
  const [esas, setEsas] = useState('');
  const [visibility, setVisibility] = useState<'org' | 'restricted'>('org');
  const [opened, setOpened] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setCode('');
    setEsas('');
    setVisibility('org');
    setOpened('');
    setError(null);
  }, [open]);

  async function submit() {
    if (title.trim().length < 2) {
      setError(t('errors.title'));
      return;
    }
    if (esas.trim() !== '' && !ESAS_RE.test(esas.trim())) {
      setError(t('errors.esas'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await documentsApi.cases.create({
        title: title.trim(),
        officeFileCode: code.trim() === '' ? null : code.trim(),
        esasNo: esas.trim() === '' ? null : esas.trim(),
        visibility,
        openedDate: opened === '' ? null : opened,
      });
      onCreated(c);
    } catch (err) {
      if (onAuth(err)) return;
      setError(
        err instanceof ApiClientError && err.code === 'ORG_ROLE_INSUFFICIENT'
          ? t('errors.role')
          : t('errors.save'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('title')}
      description={t('body')}
      labels={{ close: t('close') }}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button loading={busy} loadingLabel={t('saving')} onClick={() => void submit()}>
            {t('create')}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={t('name')} description={t('nameHint')} required>
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('code')} description={t('codeHint')}>
            <Input value={code} maxLength={40} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Field label={t('esas')} description={t('esasHint')}>
            <Input
              value={esas}
              maxLength={32}
              inputMode="numeric"
              placeholder="2026/1234"
              onChange={(e) => setEsas(e.target.value)}
            />
          </Field>
        </div>
        <Field label={t('opened')}>
          <DateField value={opened} onChange={(e) => setOpened(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <p className="text-body-sm font-medium text-fg">{t('visibility')}</p>
          <SegmentedControl
            label={t('visibility')}
            value={visibility}
            onValueChange={(v) => setVisibility(v as 'org' | 'restricted')}
            options={[
              { value: 'org', label: t('visibilityOrg') },
              { value: 'restricted', label: t('visibilityRestricted') },
            ]}
          />
          <p className="text-caption text-fg-subtle">
            {visibility === 'org' ? t('visibilityOrgHint') : t('visibilityRestrictedHint')}
          </p>
        </div>
        {error && (
          <p role="alert" className="text-body-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
