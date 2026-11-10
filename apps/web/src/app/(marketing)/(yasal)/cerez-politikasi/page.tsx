// /cerez-politikasi (053-12): yasal metin taslağı; içerik `legal.pages.cookies` kataloğundadır.
import { LegalPage, legalMetadata } from '../../../../features/marketing/legal-page.tsx';

export const generateMetadata = () => legalMetadata('cookies');

export default function CerezPolitikasiPage() {
  return <LegalPage page="cookies" />;
}
