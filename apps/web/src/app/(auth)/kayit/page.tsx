import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ProfessionScreen } from '../../../features/auth/profession-screen.tsx';
import { RegisterForm } from '../../../features/auth/register-form.tsx';
import { hasSession } from '../../../lib/server-session.ts';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.register'))('title'), robots: { index: false } };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ adim?: string; davet?: string }>;
}) {
  const { adim, davet } = await searchParams;
  if (adim === 'meslek') {
    if (!(await hasSession())) redirect('/giris?sonraki=/kayit');
    return <ProfessionScreen />;
  }
  if (!davet && (await hasSession())) redirect('/sohbet');
  return <RegisterForm />;
}
