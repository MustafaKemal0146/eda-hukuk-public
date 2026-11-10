import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { SettingsHome } from '../../../features/settings/settings-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('settings'))('title') };
}

export default function Page() {
  return <SettingsHome />;
}
