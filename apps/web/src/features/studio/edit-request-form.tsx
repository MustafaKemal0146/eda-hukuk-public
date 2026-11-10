'use client';
// "Sohbetle düzenle" istek kutusu: hazır komut çipleri (metni isteğe ekler), istek alanı ve gönder.
// Belge sohbete bu formdan gider; düzenleme sohbet hattından geçer (veri sınıfı kapısı + maskeleme).
import { Button, Field, Textarea } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { appendCommand, EDIT_COMMANDS, type EditCommand } from './edit-request.ts';

export function EditRequestForm({
  busy,
  onSubmit,
  scopeNote,
}: {
  busy: boolean;
  onSubmit: (request: string) => void;
  /** Seçili kısım için: hangi parçanın düzenleneceğini anlatan kısa not (b parçası). */
  scopeNote?: string;
}) {
  const t = useTranslations('studio.export');
  const [request, setRequest] = useState('');
  const add = (cmd: EditCommand) =>
    setRequest((cur) => appendCommand(cur, t(`commandPrompts.${cmd}`)));
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) onSubmit(request);
      }}
    >
      {scopeNote && <p className="text-body-sm text-fg-muted">{scopeNote}</p>}
      <fieldset className="m-0 flex flex-wrap gap-1.5 border-0 p-0">
        <legend className="mb-1 w-full text-caption font-medium text-fg-muted">
          {t('commandsLabel')}
        </legend>
        {EDIT_COMMANDS.map((cmd) => (
          <button
            key={cmd}
            type="button"
            onClick={() => add(cmd)}
            className="rounded-full border border-border bg-surface px-2.5 py-1 text-caption text-fg-muted transition-colors duration-fast hover:border-primary-soft-border hover:bg-primary-soft hover:text-fg focus-visible:focus-ring"
          >
            {t(`commands.${cmd}`)}
          </button>
        ))}
      </fieldset>
      <Field label={t('requestLabel')} description={t('requestHint')}>
        <Textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={4}
          maxLength={2000}
          placeholder={t('requestPlaceholder')}
        />
      </Field>
      <div className="flex justify-end">
        <Button type="submit" size="sm" loading={busy}>
          {t('send')}
        </Button>
      </div>
    </form>
  );
}
