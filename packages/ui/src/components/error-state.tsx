'use client';
// ErrorState (052 §3, §13.1): alan yüklenemedi kartı. Türkçe düzeltici ileti + "Tekrar dene" +
// "Destek kodu: <requestId>" ve kopyalama düğmesi. Yığın izi, SQL ve ham gövde gösterilmez.
// `role="alert"` yalnız yeni oluşan hatada (`live`); sayfa yüklenirken var olan hata için verilmez.
import { type ReactNode, useState } from 'react';
import { Icon } from '../icons/icon.tsx';
import { Button } from './button.tsx';
import { cn } from './cn.ts';

export type ErrorStateProps = {
  title: ReactNode;
  message?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  /** API `requestId`; "Destek kodu" olarak gösterilir. */
  requestId?: string;
  labels: {
    retry: string;
    retrying?: string;
    /** "Destek kodu" ön eki. */
    supportCode: string;
    copy: string;
    copied: string;
  };
  live?: boolean;
  as?: 'h2' | 'h3';
  className?: string;
};

export function ErrorState({
  title,
  message,
  onRetry,
  retrying = false,
  requestId,
  labels,
  live = false,
  as: H = 'h2',
  className,
}: ErrorStateProps) {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    if (requestId === undefined) return;
    try {
      await navigator.clipboard.writeText(requestId);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div
      role={live ? 'alert' : undefined}
      className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}
    >
      <span className="mb-2 inline-flex size-10 items-center justify-center rounded-lg border border-danger-border bg-danger-soft text-danger-on-soft">
        <Icon icon="notice.error" size="md" />
      </span>
      <H className="text-title text-fg">{title}</H>
      {message && <p className="max-w-md text-body-sm text-fg-muted">{message}</p>}
      {onRetry && (
        <div className="mt-3">
          <Button
            variant="outline"
            leadingIcon="action.retry"
            loading={retrying}
            {...(labels.retrying === undefined ? {} : { loadingLabel: labels.retrying })}
            onClick={onRetry}
          >
            {labels.retry}
          </Button>
        </div>
      )}
      {requestId && (
        <div className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-surface-sunken py-1 pr-1 pl-2.5 text-caption text-fg-muted">
          <span>
            {labels.supportCode}: <span className="font-mono text-fg">{requestId}</span>
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            className="inline-flex min-h-6 items-center gap-1 rounded-sm px-1.5 font-medium text-fg-muted hover:bg-primary-soft hover:text-fg focus-visible:focus-ring pointer-coarse:min-h-11"
          >
            <Icon icon="action.copy" size="sm" />
            <span>{copied ? labels.copied : labels.copy}</span>
          </button>
        </div>
      )}
    </div>
  );
}
