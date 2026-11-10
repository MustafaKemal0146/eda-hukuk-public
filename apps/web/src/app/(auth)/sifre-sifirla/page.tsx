import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ResetPasswordScreen } from '../../../features/auth/reset-password-screen.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.reset'))('title'), robots: { index: false } };
}

export default function Page() {
  return <ResetPasswordScreen />;
}
