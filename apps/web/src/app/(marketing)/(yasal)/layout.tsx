// Yasal ve Güven Merkezi sayfalarının ortak yerleşimi (053-12 §2): atlama bağlantısı, üst bilgi,
// ana içerik ve zorunlu ibareli alt bilgi. Çerez veya başlık okumaz.
import type { ReactNode } from 'react';
import { LegalShell } from '../../../features/marketing/marketing-chrome.tsx';

export default function YasalLayout({ children }: { children: ReactNode }) {
  return <LegalShell>{children}</LegalShell>;
}
