import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { CalendarHome } from '../../../features/calendar/calendar-home.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations('calendar'))('title') };
}

export default function Page() {
  return <CalendarHome />;
}
