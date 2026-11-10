'use client';
// Uygulama kabuğu: atlama bağlantıları, kenar çubuğu (>= md sabit, < md çekmece) ve çerçeveli içerik
// yüzeyi (üst çubuk + sayfa). Komut paleti ve mobil çekmece ilk açılışta tembel yüklenir (002 §7
// ilk JS bütçesi); açıldıktan sonra bağlı kalır (kapanış animasyonu ve odak dönüşü için).
// Kabuk tek `Announcer` sağlar: sayfa bileşenleri duyuruyu `useAnnounce` ile yapar (055 §4).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { Announcer, SkipLinks, TooltipProvider } from '@eda/ui';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { setSessionEndNavigator } from '../../lib/session-guard.ts';
import { AnnouncementStrip } from '../announcements/announcement-strip.tsx';
import { useCommandPaletteShortcut } from './palette-shortcut.ts';
import { Sidebar } from './sidebar.tsx';
import { Topbar } from './topbar.tsx';

const CommandPalette = dynamic(() => import('./command-palette.tsx').then((m) => m.CommandPalette));
const MobileDrawer = dynamic(() => import('./mobile-drawer.tsx').then((m) => m.MobileDrawer));

export function AppShell({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  // Oturum sayfa açıkken biterse (`guardedFetch` 401): girişe yönlen ve sunucu düzenini tazele; (app)
  // alt ağacı kapanınca ekran durumları (yoklama, akış) kendiliğinden temizlenir.
  useEffect(
    () =>
      setSessionEndNavigator((href) => {
        router.replace(href);
        router.refresh();
      }),
    [router],
  );
  const [drawer, setDrawer] = useState(false);
  const [drawerUsed, setDrawerUsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const [paletteUsed, setPaletteUsed] = useState(false);
  const openPalette = useCallback(() => {
    setPaletteUsed(true);
    setPalette(true);
  }, []);
  useCommandPaletteShortcut(openPalette);

  return (
    <TooltipProvider>
      <Announcer coalesceMs={CONFIG_DEFAULTS['ui.liveRegionCoalesceMs']}>
        <SkipLinks
          links={[
            { href: '#icerik', label: t('common.skipToContent') },
            { href: '#ana-gezinme', label: t('common.skipToNav') },
          ]}
        />
        {/* `relative overflow-hidden`: kaydırma kabı dışında kalan ekran okuyucu metinleri (sr-only, absolute)
            belgeyi uzatıp kabuğun tamamını kaydırmasın. */}
        <div className="relative flex h-dvh overflow-hidden bg-bg">
          <aside className="hidden w-sidebar shrink-0 md:block">
            <Sidebar onOpenPalette={openPalette} />
          </aside>
          {drawerUsed && (
            <MobileDrawer open={drawer} onOpenChange={setDrawer} onOpenPalette={openPalette} />
          )}
          <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface md:rounded-lg md:border md:border-border md:shadow-1">
              <Topbar
                onOpenMenu={() => {
                  setDrawerUsed(true);
                  setDrawer(true);
                }}
              />
              <AnnouncementStrip />
              <main
                id="icerik"
                tabIndex={-1}
                className="min-h-0 flex-1 overflow-y-auto focus-visible:outline-none"
              >
                {children}
              </main>
            </div>
          </div>
        </div>
        {paletteUsed && <CommandPalette open={palette} onOpenChange={setPalette} />}
      </Announcer>
    </TooltipProvider>
  );
}
