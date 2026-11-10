// /kullanim-kosullari (053-12): yasal metin taslağı; içerik `legal.pages.terms` kataloğundadır.
import { LegalPage, legalMetadata } from '../../../../features/marketing/legal-page.tsx';

export const generateMetadata = () => legalMetadata('terms');

export default function KullanimKosullariPage() {
  return <LegalPage page="terms" />;
}
