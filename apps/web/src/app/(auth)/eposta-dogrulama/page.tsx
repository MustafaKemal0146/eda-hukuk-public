import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { VerifyEmailScreen } from '../../../features/auth/verify-email-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.verifyEmail'))('title'), robots: { index: false } };
}

export default function Page() {
  return <VerifyEmailScreen />;
}
