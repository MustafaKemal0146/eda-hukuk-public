'use client';
// Message + MessageContent + MessageActions (052 §2, AI Elements `Message`/`Actions` uyarlaması;
// Apache-2.0, kod kopyalanmadı). Mesaj `<article aria-label>`; akan içerik kabında `aria-live` YOK.
// Kullanıcı mesajı sağda nötr baloncuk; asistan mesajı tam genişlikte düz metin (okuma yüzeyi).
import type { ReactNode } from 'react';
import { BrandMark } from '../components/brand.tsx';
import { cn } from '../components/cn.ts';
import { IconButton } from '../components/icon-button.tsx';

export type MessageAuthor = 'user' | 'assistant';

export type MessageProps = {
  /** Yazan: kullanıcı veya asistan (`role` ARIA özniteliğiyle karışmaması için `from`). */
  from: MessageAuthor;
  /** Erişilebilir ad ("Sizin mesajınız", "E.D.A. yanıtı, 14.32"). */
  label: string;
  /** Asistan başlık satırı (ad, zaman, sağlayıcı rozeti); kullanıcı mesajında çizilmez. */
  header?: ReactNode;
  /** Mesaj altı (kaynak özeti, eylem çubuğu). */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Message({ from, label, header, footer, className, children }: MessageProps) {
  if (from === 'user') {
    return (
      <article aria-label={label} data-role="user" className={cn('flex justify-end', className)}>
        <div className="max-w-prose rounded-lg rounded-br-sm bg-neutral-soft px-4 py-2.5 text-body text-fg">
          {children}
        </div>
      </article>
    );
  }
  return (
    <article aria-label={label} data-role="assistant" className={cn('flex gap-3', className)}>
      <BrandMark size="sm" className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {header && (
          <div className="flex flex-wrap items-center gap-2 text-caption text-fg-subtle">
            {header}
          </div>
        )}
        {children}
        {footer && <div className="flex flex-col gap-2">{footer}</div>}
      </div>
    </article>
  );
}

/** Mesaj gövdesi: uzun okuma ölçeği (prose 16/26). İçerik çağırandan (güvenli render) gelir. */
export function MessageContent({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('text-prose text-fg', className)}>{children}</div>;
}

export type MessageActionsProps = {
  labels: {
    group: string;
    copy: string;
    regenerate: string;
    like: string;
    dislike: string;
    export: string;
  };
  onCopy?: () => void;
  onRegenerate?: () => void;
  onFeedback?: (value: 'up' | 'down') => void;
  onExport?: () => void;
  /** Seçili geri bildirim (aria-pressed). */
  feedback?: 'up' | 'down' | null;
  className?: string;
};

/** Eylem çubuğu: yalnız verilen eylemler çizilir; her düğmenin adı `labels`'tan. */
export function MessageActions({
  labels,
  onCopy,
  onRegenerate,
  onFeedback,
  onExport,
  feedback = null,
  className,
}: MessageActionsProps) {
  return (
    <fieldset
      aria-label={labels.group}
      className={cn('m-0 flex min-w-0 items-center gap-0.5 border-0 p-0', className)}
    >
      {onCopy && <IconButton icon="action.copy" label={labels.copy} size="sm" onClick={onCopy} />}
      {onRegenerate && (
        <IconButton
          icon="action.regenerate"
          label={labels.regenerate}
          size="sm"
          onClick={onRegenerate}
        />
      )}
      {onFeedback && (
        <>
          <IconButton
            icon="action.feedback-up"
            label={labels.like}
            size="sm"
            aria-pressed={feedback === 'up'}
            onClick={() => onFeedback('up')}
          />
          <IconButton
            icon="action.feedback-down"
            label={labels.dislike}
            size="sm"
            aria-pressed={feedback === 'down'}
            onClick={() => onFeedback('down')}
          />
        </>
      )}
      {onExport && (
        <IconButton icon="action.export" label={labels.export} size="sm" onClick={onExport} />
      )}
    </fieldset>
  );
}
