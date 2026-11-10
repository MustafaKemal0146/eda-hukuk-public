// /kvkk-aydinlatma (053-12): yasal metin taslağı; içerik `legal.pages.kvkk` kataloğundadır.
import { LegalPage, legalMetadata } from '../../../../features/marketing/legal-page.tsx';

export const generateMetadata = () => legalMetadata('kvkk');

export default function KvkkAydinlatmaPage() {
  return <LegalPage page="kvkk" />;
}
