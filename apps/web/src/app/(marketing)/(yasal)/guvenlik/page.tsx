// /guvenlik (053-12 §6): Güven Merkezi; içerik `legal.pages.trust` kataloğundadır.
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { TrustCenter } from '../../../../features/marketing/trust-center.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legal.pages.trust');
  return {
    title: t('metaTitle'),
    description: t('description'),
    robots: { index: true, follow: true },
  };
}

export default function GuvenlikPage() {
  return <TrustCenter />;
}
