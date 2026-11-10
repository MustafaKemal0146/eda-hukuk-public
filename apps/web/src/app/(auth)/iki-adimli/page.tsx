import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TwoFactorScreen } from '../../../features/auth/two-factor-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.twoFactor'))('title'), robots: { index: false } };
}

export default function Page() {
  return <TwoFactorScreen />;
}
