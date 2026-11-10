import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { DocumentsHome } from '../../../features/documents/documents-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('documents'))('title') };
}

export default function Page() {
  return <DocumentsHome />;
}
