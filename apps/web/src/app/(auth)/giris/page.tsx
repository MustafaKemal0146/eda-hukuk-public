import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from '../../../features/auth/login-form.tsx';
import { safeNext } from '../../../lib/safe-next.ts';
import { hasSession } from '../../../lib/server-session.ts';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('auth.login'))('title') };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sonraki?: string }>;
}) {
  const { sonraki } = await searchParams;
  if (await hasSession()) redirect(safeNext(sonraki));
  const t = await getTranslations('auth.login');
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-heading-lg text-fg">{t('title')}</h1>
        <p className="mt-2 text-body-sm text-fg-muted">{t('intro')}</p>
      </div>
      <LoginForm />
    </div>
  );
}
