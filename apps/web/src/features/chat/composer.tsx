'use client';
// İstem kutusu (052 §5.2 iskeleti; akış P09/P10): Enter gönder, Shift+Enter yeni satır, otomatik büyür.
// Ekler (P21 ilk dilimi): yalnız metin içeren PDF ve Word; çipte durum rozeti ve düzeltici uyarı,
// ek işlenirken gönderim kapalı. Alt satır: ek, yargı kapsamı seçici (053/02 §4.3; seçim sohbetler arası korunur), yanıt modu.
// Yanıt modu tercihi de tarayıcıda hatırlanır (composer-mode-store). Akış sürerken Gönder yerine aynı
// konumda Durdur (053-02 §4.9); gönderim kapalıdır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { FileStatusBadge, IconButton, SegmentedControl, Textarea } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useId, useRef } from 'react';
import { ScopePicker } from '../scope/scope-picker.tsx';
import { useScope, writeScope } from '../scope/scope-store.ts';
import {
  ATTACHMENT_ACCEPT,
  type ChatAttachment,
  MAX_ATTACHMENTS,
  sendBlocked,
} from './attachments.ts';
import { useComposerMode, writeComposerMode } from './composer-mode-store.ts';

export type ComposerMode = 'fast' | 'deep';

export function Composer({
  value: text,
  onValueChange: setText,
  onSubmit,
  autoFocus = false,
  busy = false,
  onStop,
  attachments,
}: {
  value: string;
  onValueChange: (text: string) => void;
  onSubmit: (text: string, mode: ComposerMode) => void;
  autoFocus?: boolean;
  /** Yanıt üretiliyor veya istek açık: gönderim kapalı, Durdur görünür. */
  busy?: boolean;
  onStop?: () => void;
  /** Ek desteği; verilmezse ek düğmesi işlevsizdir (yalnız görünür). */
  attachments?: {
    items: readonly ChatAttachment[];
    onAdd: (files: File[]) => void;
    onRemove: (localId: string) => void;
  };
}) {
  const t = useTranslations('chat');
  const id = useId();
  const mode = useComposerMode();
  const scope = useScope();
  const ta = useTranslations('chat.attachments');
  const fileRef = useRef<HTMLInputElement>(null);
  const items = attachments?.items ?? [];
  const waiting = sendBlocked(items);
  const empty = text.trim() === '';
  const submit = (): void => {
    if (empty || busy || waiting) return;
    onSubmit(text.trim(), mode);
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="rounded-xl border border-border bg-surface shadow-2 transition-colors duration-fast focus-within:border-border-strong"
    >
      <label htmlFor={id} className="sr-only">
        {t('composerLabel')}
      </label>
      <Textarea
        id={id}
        autoGrow
        maxRows={10}
        rows={2}
        autoFocus={autoFocus}
        value={text}
        placeholder={t('composerPlaceholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        bare
        className="min-h-20 px-4 pt-3.5 text-body"
      />
      {items.length > 0 && (
        <ul
          aria-label={ta('listLabel')}
          aria-live="polite"
          className="flex flex-col gap-1.5 px-2.5 pb-2"
        >
          {items.map((a) => (
            <li
              key={a.localId}
              className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface-sunken px-2.5 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-body-sm text-fg">{a.name}</span>
                {a.phase !== 'error' && (
                  <FileStatusBadge
                    status={a.status ?? 'uploaded'}
                    labels={{
                      uploaded: ta('status.uploaded'),
                      scanning: ta('status.scanning'),
                      extracting: ta('status.extracting'),
                      chunking: ta('status.processing'),
                      embedding: ta('status.processing'),
                      ready: ta('status.ready'),
                      failed: ta('status.failed'),
                      quarantined: ta('status.quarantined'),
                      ocr_skipped: ta('status.noText'),
                    }}
                  />
                )}
                <IconButton
                  icon="action.close"
                  size="sm"
                  label={ta('remove', { name: a.name })}
                  onClick={() => attachments?.onRemove(a.localId)}
                />
              </div>
              {a.error && (
                <p role="alert" className="text-caption text-danger">
                  {ta(`errors.${a.error}`, {
                    max: MAX_ATTACHMENTS,
                    maxMb: CONFIG_DEFAULTS['upload.maxMb'],
                  })}
                </p>
              )}
              {!a.error && a.scanWaiting && (
                <p className="text-caption text-fg-muted">{ta('scanWaiting')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-1.5 px-2.5 pb-2.5">
        {attachments ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              hidden
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const files = [...(e.target.files ?? [])];
                e.target.value = '';
                if (files.length > 0) attachments.onAdd(files);
              }}
            />
            <IconButton
              icon="action.attach"
              label={t('attach')}
              title={ta('hint')}
              onClick={() => fileRef.current?.click()}
            />
          </>
        ) : (
          <IconButton icon="action.attach" label={t('attach')} />
        )}
        <ScopePicker value={scope} onChange={writeScope} />
        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl
            label={t('modeLabel')}
            value={mode}
            onValueChange={writeComposerMode}
            options={[
              { value: 'fast', label: t('modeFast') },
              { value: 'deep', label: t('modeDeep') },
            ]}
          />
          {busy && onStop ? (
            <IconButton icon="action.stop" label={t('stop')} variant="outline" onClick={onStop} />
          ) : (
            <IconButton
              type="submit"
              icon="action.send"
              label={t('send')}
              variant="primary"
              disabled={empty || busy || waiting}
              {...(waiting ? { title: ta('waiting') } : {})}
              aria-keyshortcuts="Enter"
              className="disabled:border-disabled-bg disabled:bg-disabled-bg disabled:shadow-none"
            />
          )}
        </div>
      </div>
    </form>
  );
}
