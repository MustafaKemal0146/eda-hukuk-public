import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { LegislationHome } from '../../../features/legislation/legislation-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('legislation'))('title') };
}

export default function Page() {
  return (
    <Suspense>
      <LegislationHome />
    </Suspense>
  );
}
