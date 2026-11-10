// Yönetim kök yerleşimi: lang="tr", sistem teması (tercih çerezi P27'de), self-host yazı tipleri.
import '../styles/globals.css';
import { CSPProvider } from '@base-ui/react/csp-provider';
import { THEME_COLOR_META } from '@eda/ui/tokens';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import type { ReactNode } from 'react';
import { NONCE_HEADER } from '../lib/csp.ts';
import { CspClientGuard } from '../lib/csp-client.tsx';
import { fontVariables } from './fonts.ts';

export const metadata: Metadata = {
  title: { default: 'E.D.A. Hukuk Yönetim', template: '%s · E.D.A. Hukuk Yönetim' },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR_META.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR_META.dark },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  // Proxy'nin ürettiği istek nonce'u: Base UI'nin satır içi <style>/<script> öğeleri de taşır (061 §2.3).
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html lang="tr" data-theme="system" data-density="comfortable" className={fontVariables}>
      <body className="bg-bg font-sans text-body text-fg antialiased">
        <CspClientGuard />
        <CSPProvider nonce={nonce}>
          <NextIntlClientProvider locale="tr" messages={messages}>
            {children}
          </NextIntlClientProvider>
        </CSPProvider>
      </body>
    </html>
  );
}
