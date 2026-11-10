// Tanıtım ve yasal sayfaların ortak üst/alt bilgisi (053-12 §2). Sunucu bileşenleri; çerez, başlık
// veya API okumaz. Alt bilgi her sayfada Y-87 ibaresini ve yasal bağlantıları taşır.
import { SkipLinks } from '@eda/ui';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { fillConfig } from './placeholders.ts';
import type { Translator } from './translator.ts';

const LEGAL_LINKS = [
  { href: '/kvkk-aydinlatma', key: 'kvkk' },
  { href: '/kullanim-kosullari', key: 'terms' },
  { href: '/gizlilik', key: 'privacy' },
  { href: '/cerez-politikasi', key: 'cookies' },
] as const;

/** Alt bilgi: marka, ürün/yasal/iletişim sütunları, zorunlu ibare (Y-87) ve şirket satırı. */
export async function MarketingFooter() {
  return <MarketingFooterView t={await getTranslations('legal')} />;
}

export function MarketingFooterView({ t }: { t: Translator }) {
  const link =
    'text-body-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:focus-ring';
  return (
    <footer className="mt-16 border-t border-border bg-surface-sunken">
      <div className="mx-auto flex w-full max-w-content flex-col gap-8 px-6 py-10">
        <div className="grid gap-8 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <p className="font-display text-title text-fg">{t('chrome.brand')}</p>
            <p className="text-body-sm text-fg-muted">{t('chrome.footerTagline')}</p>
          </div>
          <nav aria-label={t('chrome.legalHeading')} className="flex flex-col gap-2">
            <p className="text-label text-fg">{t('chrome.legalHeading')}</p>
            <ul className="flex flex-col gap-2">
              {LEGAL_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className={link}>
                    {t(`chrome.links.${l.key}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label={t('chrome.product')} className="flex flex-col gap-2">
            <p className="text-label text-fg">{t('chrome.product')}</p>
            <ul className="flex flex-col gap-2">
              <li>
                <a href="/guvenlik" className={link}>
                  {t('chrome.links.trust')}
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <div className="flex flex-col gap-2 border-t border-border pt-6">
          <p className="max-w-chat text-body-sm text-fg">{t('mandatory.y87')}</p>
          <p className="text-body-sm text-fg-subtle">
            {fillConfig(String(t.raw('chrome.companyLine')))}
          </p>
          <p className="text-body-sm text-fg-subtle">
            {t('chrome.contactHeading')}: {fillConfig(String(t.raw('chrome.supportMail')))}
          </p>
        </div>
      </div>
    </footer>
  );
}

/** Yasal sayfa kabuğu: atlama bağlantısı, üst bilgi, ana içerik, alt bilgi. */
export async function LegalShell({ children }: { children: ReactNode }) {
  const t = await getTranslations('legal');
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <SkipLinks links={[{ href: '#icerik', label: t('chrome.skip') }]} />
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-content items-center gap-6 px-6 py-5">
          <a
            href="/"
            className="rounded-md font-display text-title font-semibold tracking-tight text-fg focus-visible:focus-ring"
          >
            {t('chrome.brand')}
          </a>
          <nav aria-label={t('chrome.mainNav')} className="ml-auto flex items-center gap-4">
            <a
              href="/guvenlik"
              className="text-body-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline focus-visible:focus-ring"
            >
              {t('chrome.links.trust')}
            </a>
          </nav>
        </div>
      </header>
      <main id="icerik" className="mx-auto w-full max-w-doc flex-1 px-6 pt-12">
        {children}
      </main>
      <MarketingFooter />
    </div>
  );
}
