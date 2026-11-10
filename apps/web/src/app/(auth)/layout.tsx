// Kimlik doğrulama yerleşimi (053-01 §2): sol form sütunu, >= lg sağda koyu alıntı paneli.
import { Icon } from '@eda/ui';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { QuotePanel } from '../../features/auth/quote-panel.tsx';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations();
  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-auth xl:grid-cols-auth-wide">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Link
          href="/"
          className="flex w-fit items-center gap-2.5 rounded-md focus-visible:focus-ring"
        >
          <span className="font-display text-title font-semibold tracking-tight text-fg">
            {t('common.brand')}
          </span>
        </Link>
        <main
          id="icerik"
          className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12"
        >
          {children}
        </main>
        <footer className="flex flex-col gap-2 text-caption text-fg-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Icon icon="status.secure" size="sm" />
            {t('auth.footer.tls')}
          </span>
          <nav aria-label={t('auth.footer.legal')} className="flex flex-wrap gap-4">
            <a href="/kullanim-kosullari" className="hover:text-fg focus-visible:focus-ring">
              {t('auth.footer.terms')}
            </a>
            <a href="/kvkk-aydinlatma" className="hover:text-fg focus-visible:focus-ring">
              {t('auth.footer.kvkk')}
            </a>
            <a href="/guvenlik" className="hover:text-fg focus-visible:focus-ring">
              {t('auth.footer.trust')}
            </a>
          </nav>
          <p className="text-body-sm text-fg-muted">{t('legal.mandatory.y87')}</p>
        </footer>
      </div>
      <QuotePanel />
    </div>
  );
}
