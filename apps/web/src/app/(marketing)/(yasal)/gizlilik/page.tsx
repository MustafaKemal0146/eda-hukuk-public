// /gizlilik (053-12): yasal metin taslağı; içerik `legal.pages.privacy` kataloğundadır.
import { LegalPage, legalMetadata } from '../../../../features/marketing/legal-page.tsx';

export const generateMetadata = () => legalMetadata('privacy');

export default function GizlilikPage() {
  return <LegalPage page="privacy" />;
}
