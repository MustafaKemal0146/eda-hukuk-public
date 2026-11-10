'use client';
// Popover (052 §3): modal olmayan etkileşimli açılır içerik (kapsam seçici, süre rozeti, bildirim
// paneli). Tetikleyici `aria-haspopup="dialog"` + `aria-expanded` (Base UI); odak içeri, Esc ve kapat
// düğmesi odağı tetikleyiciye döndürür. Etkileşimsiz kısa açıklama için `Tooltip` kullanılır.
import { Popover as Base } from '@base-ui/react/popover';
import type { ReactElement, ReactNode } from 'react';
import { cn } from './cn.ts';
import { IconButton } from './icon-button.tsx';

export type PopoverProps = {
  trigger: ReactElement;
  /** Başlık; erişilebilir ad olarak açılır pencereye bağlanır. */
  title?: ReactNode;
  description?: ReactNode;
  /** Kapat düğmesi etiketi; verilirse başlık satırında kapat düğmesi çizilir. */
  labels?: { close: string };
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  size?: 'sm' | 'md' | 'lg';
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
};

const SIZE = { sm: 'w-72', md: 'w-96', lg: 'w-xl' } as const;

export function Popover({
  trigger,
  title,
  description,
  labels,
  side = 'bottom',
  align = 'start',
  size = 'sm',
  open,
  onOpenChange,
  children,
}: PopoverProps) {
  const controlled =
    open === undefined ? {} : { open, onOpenChange: (next: boolean) => onOpenChange?.(next) };
  return (
    <Base.Root {...controlled}>
      <Base.Trigger render={trigger} />
      <Base.Portal>
        <Base.Positioner side={side} align={align} sideOffset={8} className="z-dropdown">
          <Base.Popup
            className={cn(
              'flex max-h-available max-w-drawer flex-col rounded-lg border border-border bg-surface-raised shadow-2 focus-visible:focus-ring',
              SIZE[size],
            )}
          >
            {(title || labels) && (
              <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0 flex-1">
                  {title && (
                    <Base.Title className="text-body-sm font-semibold text-fg">{title}</Base.Title>
                  )}
                  {description && (
                    <Base.Description className="mt-0.5 text-caption text-fg-muted">
                      {description}
                    </Base.Description>
                  )}
                </div>
                {labels && (
                  <Base.Close
                    render={<IconButton icon="action.close" label={labels.close} size="sm" />}
                  />
                )}
              </div>
            )}
            <div className="min-h-0 overflow-y-auto px-4 py-3 text-body-sm text-fg">{children}</div>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
