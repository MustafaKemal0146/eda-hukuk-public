import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { DecisionView } from '../../../../../features/decisions/decision-view.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('archive'))('title') };
}

export default async function Page({ params }: PageProps<'/karar-arsivi/karar/[decisionId]'>) {
  const { decisionId } = await params;
  return (
    <Suspense>
      <DecisionView key={decisionId} decisionId={decisionId} />
    </Suspense>
  );
}
