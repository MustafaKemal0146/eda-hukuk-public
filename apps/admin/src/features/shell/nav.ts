// Yönetim gezinmesi: yalnız UYGULANMIŞ modüller çizilir (053-ekranlar/11 §1.2). `support` yalnız
// Kiracılar, Kullanıcılar ve Denetim'i görür; MVP'de support hesabı açılmaz ama menü rolü yine yansıtır.
import type { IconName } from '@eda/ui';

export type AdminRole = 'super_admin' | 'support';

export type NavKey =
  | 'overview'
  | 'applications'
  | 'stats'
  | 'users'
  | 'usage'
  | 'announcements'
  | 'ai'
  | 'system'
  | 'templates'
  | 'support'
  | 'datasets'
  | 'audit'
  | 'chatReports';

export interface NavEntry {
  readonly key: NavKey;
  readonly href: string;
  readonly icon: IconName;
  readonly roles: readonly AdminRole[];
}

export const NAV: readonly NavEntry[] = [
  { key: 'overview', href: '/', icon: 'nav.chat', roles: ['super_admin'] },
  { key: 'applications', href: '/basvurular', icon: 'status.verified', roles: ['super_admin'] },
  { key: 'stats', href: '/istatistikler', icon: 'nav.calendar', roles: ['super_admin'] },
  { key: 'users', href: '/kullanicilar', icon: 'nav.account', roles: ['super_admin', 'support'] },
  { key: 'usage', href: '/kullanim', icon: 'nav.settings', roles: ['super_admin'] },
  // `support` duyuruları yalnız okur (yazma uçları super_admin + step-up ister).
  {
    key: 'announcements',
    href: '/duyurular',
    icon: 'nav.notifications',
    roles: ['super_admin', 'support'],
  },
  { key: 'ai', href: '/yapay-zeka', icon: 'nav.settings', roles: ['super_admin'] },
  { key: 'system', href: '/sistem', icon: 'nav.settings', roles: ['super_admin'] },
  {
    key: 'templates',
    href: '/sablonlar',
    icon: 'nav.documents',
    roles: ['support', 'super_admin'],
  },
  { key: 'support', href: '/destek', icon: 'nav.support', roles: ['support', 'super_admin'] },
  { key: 'datasets', href: '/veri-seti', icon: 'nav.decisions', roles: ['support', 'super_admin'] },
  { key: 'audit', href: '/denetim', icon: 'nav.search', roles: ['super_admin', 'support'] },
  { key: 'chatReports', href: '/sohbetler', icon: 'nav.new-chat', roles: ['super_admin'] },
];

export function navFor(role: AdminRole): readonly NavEntry[] {
  return NAV.filter((n) => n.roles.includes(role));
}

export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}
