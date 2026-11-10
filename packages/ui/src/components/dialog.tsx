'use client';
// Dialog (052 §3): odak tuzağı, arka plan erişilemez, Esc, her zaman kapat düğmesi. Arka plan bulanıklaştırılmaz.
// Modal içinde modal açılmaz (useModalGuard; 052 §14.2).
import { Dialog as Base } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';
import { IconButton } from './icon-button.tsx';
import { useModalGuard } from './modal-guard.ts';

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  labels: { close: string };
  footer?: ReactNode;
  /** Başlık görsel olarak gizlensin mi (komut paleti gibi; erişilebilir ad korunur). */
  hideTitle?: boolean;
  /** Dikeyde üstte konumla (komut paleti). */
  placement?: 'center' | 'top';
  children?: ReactNode;
};

const SIZE = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' } as const;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  labels,
  footer,
  hideTitle = false,
  placement = 'center',
  children,
}: DialogProps) {
  const allowedOpen = useModalGuard(open, () => onOpenChange(false));
  return (
    <Base.Root open={allowedOpen} onOpenChange={onOpenChange}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-overlay bg-scrim" />
        <Base.Popup
          className={cn(
            'fixed left-1/2 z-dialog flex w-dialog -translate-x-1/2 flex-col rounded-lg border border-border bg-surface-raised shadow-3',
            'max-h-dialog focus-visible:focus-ring',
            placement === 'top' ? 'top-dialog' : 'top-1/2 -translate-y-1/2',
            SIZE[size],
          )}
        >
          <div className={cn('flex items-start gap-3 px-5 pt-5', hideTitle && 'sr-only')}>
            <div className="min-w-0 flex-1">
              <Base.Title className="text-title text-fg">{title}</Base.Title>
              {description && (
                <Base.Description className="mt-1 text-body-sm text-fg-muted">
                  {description}
                </Base.Description>
              )}
            </div>
          </div>
          <div className="absolute top-3 right-3">
            <Base.Close
              render={<IconButton icon="action.close" label={labels.close} size="sm" />}
            />
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto', hideTitle ? 'p-0' : 'px-5 py-4')}>
            {children}
          </div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-3">
              {footer}
            </div>
          )}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}
