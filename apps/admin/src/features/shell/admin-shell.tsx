'use client';
// Yönetim kabuğu: sol menü, üst çubuk (kullanıcı, oturum bitişi, çıkış). Global arama yok.
import type { AdminMeDtoValue } from '@eda/contracts/api/admin';
import { Badge, Button, Icon } from '@eda/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useState } from 'react';
import { setSessionEndNavigator } from '../../lib/session-guard.ts';
import { isActive, navFor } from './nav.ts';

export function AdminShell({ me, children }: { me: AdminMeDtoValue; children: ReactNode }) {
  const t = useTranslations();
  const format = useFormatter();
  const pathname = usePathname();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  // Oturum sayfa açıkken biterse (adminFetch 401): girişe yönlen, sunucu bileşenlerini tazele. Panel
  // bileşenleri kapanır; bekleyen yoklama/yeniden denemeler `adminFetch` kapısında düşer.
  useEffect(
    () =>
      setSessionEndNavigator((href) => {
        router.replace(href);
        router.refresh();
      }),
    [router],
  );

  async function signOut() {
    setLeaving(true);
    try {
      await fetch('/api/auth/sign-out', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
    } finally {
      router.replace('/giris');
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {me.maintenanceMode && (
        <p role="status" className="bg-info-soft px-4 py-1 text-center text-caption text-fg">
          {t('shell.maintenance')}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t('shell.nav')}
          className="hidden w-64 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 md:flex"
        >
          <div className="flex items-center gap-2 px-2 pb-4">
            <span className="font-display text-title font-semibold tracking-tight text-fg">
              {t('common.brand')}
            </span>
            <Badge tone="inverse">{t('common.admin')}</Badge>
          </div>
          <ul className="flex flex-col gap-px">
            {navFor(me.platformRole).map((n) => {
              const active = isActive(pathname, n.href);
              return (
                <li key={n.key}>
                  <Link
                    href={n.href}
                    aria-current={active ? 'page' : undefined}
                    className={`flex min-h-control-md items-center gap-2.5 rounded-md px-2.5 text-body-sm transition-colors duration-fast focus-visible:focus-ring ${
                      active
                        ? 'bg-primary-soft font-medium text-fg'
                        : 'text-fg-muted hover:bg-surface-sunken hover:text-fg'
                    }`}
                  >
                    <Icon icon={n.icon} size="sm" className="text-fg-subtle" />
                    {t(`nav.${n.key}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-topbar shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
            <div className="min-w-0 flex-1 md:hidden">
              <span className="font-display text-title font-semibold text-fg">
                {t('common.brand')}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <p className="hidden text-caption text-fg-subtle sm:block">
                {t('shell.sessionUntil', {
                  time: format.dateTime(new Date(me.session.expiresAt), {
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </p>
              <div className="text-right">
                <p className="text-body-sm font-medium text-fg">{me.name}</p>
                <p className="text-caption text-fg-subtle">{t(`role.${me.platformRole}`)}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                loading={leaving}
                loadingLabel={t('shell.signingOut')}
                onClick={() => void signOut()}
              >
                {t('shell.signOut')}
              </Button>
            </div>
          </header>
          <main id="icerik" className="min-w-0 flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
