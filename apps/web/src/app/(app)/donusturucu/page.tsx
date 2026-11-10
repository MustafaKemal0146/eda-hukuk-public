import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ConverterHome } from '../../../features/converter/converter-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('converter'))('title') };
}

export default function Page() {
  return <ConverterHome />;
}
