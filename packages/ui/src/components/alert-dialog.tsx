'use client';
// AlertDialog (052 §3, §14.2): geri dönüşsüz onay. Varsayılan odak "Vazgeç"; Esc = vazgeç; dış tıklama
// kapatmaz (Base UI AlertDialog). Ne silineceği ve etkisi `impact` ile yazılır. Modal içinde modal yok.
import { AlertDialog as Base } from '@base-ui/react/alert-dialog';
import { type ReactNode, useRef } from 'react';
import { Button, buttonClasses } from './button.tsx';
import { cn } from './cn.ts';
import { useModalGuard } from './modal-guard.ts';

export type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Etki özeti: ne silinecek, kaç öğe, geri alınabilir mi (052 §14.2). */
  impact?: ReactNode;
  cancelLabel: string;
  destructiveLabel: string;
  onConfirm: () => void;
  /** Onay sürerken düğme `aria-busy`; çift gönderim engellenir. */
  confirmLoading?: boolean;
  confirmLoadingLabel?: string;
  /** Yıkıcı olmayan onaylar için birincil ton. */
  tone?: 'danger' | 'primary';
};

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  cancelLabel,
  destructiveLabel,
  onConfirm,
  confirmLoading = false,
  confirmLoadingLabel,
  tone = 'danger',
}: AlertDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const allowedOpen = useModalGuard(open, () => onOpenChange(false));
  return (
    <Base.Root open={allowedOpen} onOpenChange={(next: boolean) => onOpenChange(next)}>
      <Base.Portal>
        <Base.Backdrop className="fixed inset-0 z-overlay bg-scrim" />
        <Base.Popup
          initialFocus={cancelRef}
          className={cn(
            'fixed top-1/2 left-1/2 z-dialog flex w-dialog max-w-md -translate-x-1/2 -translate-y-1/2 flex-col',
            'rounded-lg border border-border bg-surface-raised shadow-3 focus-visible:focus-ring',
          )}
        >
          <div className="flex flex-col gap-2 px-5 pt-5 pb-4">
            <Base.Title className="text-title text-fg">{title}</Base.Title>
            {description && (
              <Base.Description className="text-body-sm text-fg-muted">
                {description}
              </Base.Description>
            )}
            {impact && (
              <div className="mt-1 rounded-md border border-border bg-surface-sunken px-3 py-2.5 text-body-sm text-fg">
                {impact}
              </div>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 border-t border-border bg-surface-sunken px-5 py-3 sm:flex-row sm:justify-end">
            <Base.Close ref={cancelRef} data-slot="cancel" className={buttonClasses('outline')}>
              {cancelLabel}
            </Base.Close>
            <Button
              variant={tone === 'danger' ? 'danger' : 'primary'}
              loading={confirmLoading}
              {...(confirmLoadingLabel === undefined ? {} : { loadingLabel: confirmLoadingLabel })}
              onClick={onConfirm}
            >
              {destructiveLabel}
            </Button>
          </div>
        </Base.Popup>
      </Base.Portal>
    </Base.Root>
  );
}
