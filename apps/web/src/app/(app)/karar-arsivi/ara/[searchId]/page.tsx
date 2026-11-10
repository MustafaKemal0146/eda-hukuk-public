import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ArchiveResults } from '../../../../../features/decisions/archive-results.tsx';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('archive');
  return { title: `${t('results.title')} · ${t('title')}` };
}

export default async function Page({ params }: PageProps<'/karar-arsivi/ara/[searchId]'>) {
  const { searchId } = await params;
  return (
    <Suspense>
      <ArchiveResults key={searchId} searchId={searchId} />
    </Suspense>
  );
}
