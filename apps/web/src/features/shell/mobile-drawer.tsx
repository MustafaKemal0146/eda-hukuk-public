'use client';
// Mobil gezinme çekmecesi (< md): yalnız açıldığında tembel yüklenir (ilk JS bütçesi, 002 §7).
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { IconButton } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { Sidebar } from './sidebar.tsx';

export function MobileDrawer({
  open,
  onOpenChange,
  onOpenPalette,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPalette: () => void;
}) {
  const t = useTranslations();
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="fixed inset-0 z-overlay bg-scrim md:hidden" />
        <BaseDialog.Popup className="fixed inset-y-0 left-0 z-dialog w-sidebar max-w-drawer border-r border-border bg-bg shadow-3 md:hidden">
          <BaseDialog.Title className="sr-only">{t('nav.label')}</BaseDialog.Title>
          <div className="absolute top-2 right-2">
            <BaseDialog.Close
              render={<IconButton icon="action.close" label={t('common.close')} />}
            />
          </div>
          <Sidebar
            onNavigate={() => onOpenChange(false)}
            onOpenPalette={() => {
              onOpenChange(false);
              onOpenPalette();
            }}
          />
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
