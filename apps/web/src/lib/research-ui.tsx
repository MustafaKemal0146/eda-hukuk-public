'use client';
// Karar Arşivi ve Mevzuat ekranlarının ortak küçük parçaları: tarih biçimi, panoya kopyalama düğmesi
// (başarı tek polite duyuru; reddedilirse metin seçilebilir kutuda gösterilir) ve resmî kaynak
// bağlantısı (yalnız izinli resmî alan adı; yeni sekme, `noopener noreferrer`, `no-referrer`).
import { Button, type ButtonProps, Icon, useAnnounce } from '@eda/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { safeHref } from './safe-link.ts';

/** `YYYY-MM-DD` → `GG.AA.YYYY` (saat dilimi dönüşümü yok). */
export function formatIsoDate(iso: string | null): string | null {
  if (iso === null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

export function CopyButton({
  text,
  children,
  copiedLabel,
  failedLabel,
  announceText,
  ...rest
}: Omit<ButtonProps, 'onClick' | 'children'> & {
  text: string;
  children: ReactNode;
  copiedLabel: string;
  failedLabel: string;
  /** Başarıda duyurulacak metin (varsayılan `copiedLabel`). */
  announceText?: string;
}) {
  const announce = useAnnounce();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <span className="inline-flex flex-col gap-1">
      <Button
        {...rest}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setState('copied');
            announce(announceText ?? copiedLabel);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setState('idle'), 2600);
          } catch {
            setState('failed');
          }
        }}
      >
        {state === 'copied' ? copiedLabel : children}
      </Button>
      {state === 'failed' && (
        <span className="flex max-w-md flex-col gap-1 text-caption text-fg-muted">
          {failedLabel}
          <textarea
            readOnly
            value={text}
            aria-label={failedLabel}
            rows={Math.min(6, text.split('\n').length + 1)}
            className="rounded-sm border border-border bg-surface-sunken p-2 font-mono text-caption text-fg"
            onFocus={(e) => e.currentTarget.select()}
          />
        </span>
      )}
    </span>
  );
}

/** Resmî kaynak bağlantısı; izin listesi dışındaysa hiç çizilmez. */
export function OfficialLink({
  href,
  children,
  label,
  className,
}: {
  href: string | null;
  children: ReactNode;
  label?: string;
  className?: string;
}) {
  const safe = safeHref(href);
  if (!safe) return null;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      aria-label={label}
      className={
        className ??
        'inline-flex min-h-control-sm items-center gap-1.5 rounded-md px-2 text-body-sm text-primary underline-offset-2 hover:underline focus-visible:focus-ring pointer-coarse:min-h-11'
      }
    >
      {children}
      <Icon icon="action.external" size="sm" />
    </a>
  );
}
