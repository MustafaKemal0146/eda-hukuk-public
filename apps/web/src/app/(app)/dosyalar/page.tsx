import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { FilesHome } from '../../../features/cases/files-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('files'))('title') };
}

export default function Page() {
  return <FilesHome />;
}
