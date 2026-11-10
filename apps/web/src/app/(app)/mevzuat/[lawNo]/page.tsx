import { LAW_NO_PATTERN } from '@eda/contracts/api';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LawView } from '../../../../features/legislation/law-view.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('legislation'))('title') };
}

export default async function Page({ params }: PageProps<'/mevzuat/[lawNo]'>) {
  const { lawNo } = await params;
  // 053-05 §1.1: biçim dışı parametre 404 sayfasıdır.
  if (!LAW_NO_PATTERN.test(lawNo)) notFound();
  return (
    <Suspense>
      <LawView key={lawNo} lawNo={lawNo} />
    </Suspense>
  );
}
