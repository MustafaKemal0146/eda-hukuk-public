import { ARTICLE_NO_URL_PATTERN, LAW_NO_PATTERN } from '@eda/contracts/api';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Suspense } from 'react';
import { ArticleView } from '../../../../../features/legislation/article-view.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('legislation'))('title') };
}

export default async function Page({ params }: PageProps<'/mevzuat/[lawNo]/[articleNo]'>) {
  const { lawNo, articleNo } = await params;
  // 053-05 §1.1: biçim dışı parametre 404 sayfasıdır.
  if (!LAW_NO_PATTERN.test(lawNo) || !ARTICLE_NO_URL_PATTERN.test(articleNo)) notFound();
  return (
    <Suspense>
      <ArticleView key={`${lawNo}/${articleNo}`} lawNo={lawNo} articleNo={articleNo} />
    </Suspense>
  );
}
