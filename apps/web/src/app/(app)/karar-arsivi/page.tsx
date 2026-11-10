import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ArchiveHome } from '../../../features/decisions/archive-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('archive'))('title') };
}

export default function Page() {
  return <ArchiveHome />;
}
