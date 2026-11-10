'use client';
// Üst çubuk (içerik çerçevesinin üstü): mobil menü, konum (etkin bölüm), sayfa eylem yuvası, tema, bildirimler.
import { Icon, IconButton } from '@eda/ui';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NotificationBell } from '../notifications/notification-bell.tsx';
import { activeEntry } from './nav.ts';
import { ThemeMenu } from './theme-menu.tsx';

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const t = useTranslations();
  const entry = activeEntry(usePathname());
  return (
    <header className="sticky top-0 z-topbar flex h-topbar shrink-0 items-center gap-2 border-b border-border bg-surface px-3 md:px-4">
      <IconButton
        icon="nav.menu"
        label={t('nav.openMenu')}
        className="md:hidden"
        onClick={onOpenMenu}
      />
      <nav aria-label={t('topbar.location')} className="min-w-0 flex-1">
        <ol className="flex items-center gap-1.5 text-body-sm">
          <li className="hidden text-fg-subtle sm:block">{t('topbar.workspace')}</li>
          {entry && (
            <>
              <li aria-hidden="true" className="hidden text-fg-subtle sm:block">
                /
              </li>
              <li
                aria-current="page"
                className="flex min-w-0 items-center gap-1.5 font-medium text-fg"
              >
                <Icon icon={entry.icon} size="sm" className="text-fg-subtle" />
                <span className="truncate">{t(`nav.${entry.labelKey}`)}</span>
              </li>
            </>
          )}
        </ol>
      </nav>
      <div className="flex items-center gap-0.5">
        <ThemeMenu />
        <NotificationBell />
      </div>
    </header>
  );
}
