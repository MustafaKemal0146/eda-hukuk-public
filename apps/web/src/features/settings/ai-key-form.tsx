'use client';
// API anahtarı giriş formu (#54 BYOK): anahtar parola alanında girilir (gizli), kaydedilince alan
// temizlenir ve yalnız son 4 karakter görünür. Anahtar yerel durumda tutulur, başka yere yazılmaz.
import { Button, Field, PasswordInput } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type AiKeySaveProblem, keyFormatIssue } from './ai-keys-model.ts';

export interface AiKeyFormProps {
  /** Alanın etiketi (örn. "Büro/baro API anahtarı"). */
  readonly label: string;
  readonly saveLabel: string;
  readonly disabled?: boolean;
  /** Kayıt başarısızsa kaydı yapan üst bileşen hatayı verir; başarılıysa `null` döner. */
  readonly onSave: (apiKey: string) => Promise<AiKeySaveProblem | null>;
}

export function AiKeyForm({ label, saveLabel, disabled, onSave }: AiKeyFormProps) {
  const t = useTranslations('settings.apiKeys');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<AiKeySaveProblem | null>(null);
  const labels = { show: t('showKey'), hide: t('hideKey') };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    if (keyFormatIssue(value) !== null) {
      setProblem('format');
      return;
    }
    setBusy(true);
    try {
      const result = await onSave(value.trim());
      setProblem(result);
      // Başarıda anahtar alandan silinir; ekranda yalnız son 4 karakter kalır.
      if (result === null) setValue('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <Field
        label={label}
        description={t('keyHint')}
        {...(problem === null ? {} : { error: t(`problems.${problem}`) })}
      >
        <PasswordInput
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled === true || busy}
          labels={labels}
        />
      </Field>
      <div>
        <Button
          type="submit"
          loading={busy}
          loadingLabel={t('verifying')}
          disabled={disabled === true || value.trim() === ''}
        >
          {saveLabel}
        </Button>
      </div>
    </form>
  );
}
