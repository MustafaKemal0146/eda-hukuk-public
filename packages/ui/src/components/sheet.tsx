'use client';
// Sheet (052 §3, §14.2): kenardan modal çekmece (mobil menü, filtre, mobil kaynak çekmecesi).
// Base UI Dialog üzerine: odak tuzağı, `inert` arka plan, Esc ve kapat düğmesi; kapanınca odak
// tetikleyiciye döner. Modal olmayan kaynak çekmecesi bu bileşen değildir (`complementary` bölge).
import { Dialog as Base } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';
import { IconButton } from './icon-button.tsx';
import { useModalGuard } from './modal-guard.ts';

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  side?: 'left' | 'right';
  /** Genişlik: kenar çubuğu (`nav`) veya kaynak paneli (`panel`) ölçüsü. */
  width?: 'nav' | 'panel';
  labels: { close: string };
  footer?: ReactNode;
  children?: ReactNode;
};

const SIDE = {
  left: 'left-0 border-r',
  right: 'right-0 border-l',
} as const;
const WIDTH = { nav: 'w-sidebar', panel: 'w-panel-sources' } as const;

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  side = 'right',
  width = 'panel',
  labels,
  footer,
  children,
}: SheetProps) {
  const allowedOpen = useModalGuard(open, () => onOpenChange(false));
  return (
    <Base.Root open={allowedOpen} onOpenChange={(next: boolean) => onOpenChange(next)}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-overlay bg-scrim" />
        <Base.Popup
          data-side={side}
          className={cn(
            'fixed inset-y-0 z-dialog flex max-w-drawer flex-col border-border bg-surface-raised shadow-3',
            'focus-visible:focus-ring-inset',
            SIDE[side],
            WIDTH[width],
          )}
        >
          <div className="flex items-start gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0 flex-1">
              <Base.Title className="text-title text-fg">{title}</Base.Title>
              {description && (
                <Base.Description className="mt-0.5 text-body-sm text-fg-muted">
                  {description}
                </Base.Description>
              )}
            </div>
            <Base.Close
              render={<IconButton icon="action.close" label={labels.close} size="sm" />}
            />
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken px-4 py-3">
              {footer}
            </div>
          )}
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}
