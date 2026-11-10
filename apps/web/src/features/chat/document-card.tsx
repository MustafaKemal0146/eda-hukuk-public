'use client';
// Belge kartı: sohbet gövdesinde belge metni yerine görünür; tıklanınca metin sağ panelde açılır.
import { Icon } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { type DocumentBlock, wordCount } from './documents.ts';

export function DocumentCard({
  block,
  active,
  onOpen,
}: {
  block: DocumentBlock;
  active: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations('chat.document');
  const title = block.title || t('untitled');
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={active}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left shadow-1 transition-colors duration-fast focus-visible:focus-ring ${
        active
          ? 'border-border-strong bg-primary-soft'
          : 'border-border bg-surface hover:bg-surface-sunken'
      }`}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-sunken text-fg-muted">
        <Icon icon="nav.documents" size="md" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body font-medium text-fg">{title}</span>
        <span className="text-caption text-fg-subtle">
          {block.complete
            ? t('meta', { count: wordCount(block.body) })
            : t('writing', { count: wordCount(block.body) })}
        </span>
      </span>
      <span className="shrink-0 text-body-sm font-medium text-primary">{t('open')}</span>
    </button>
  );
}
