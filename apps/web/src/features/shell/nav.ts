// Ana gezinme kaydı: rota (002 §16), simge (051 §11) ve metin anahtarı. Kenar çubuğu ve komut paleti paylaşır.
import type { IconName } from '@eda/ui/icons';

export type NavLabelKey =
  | 'chat'
  | 'decisions'
  | 'legislation'
  | 'converter'
  | 'files'
  | 'documents'
  | 'calendar'
  | 'settings';

export type NavEntry = { href: string; icon: IconName; labelKey: NavLabelKey };

export type NavGroup = { key: 'work' | 'research' | 'office'; items: readonly NavEntry[] };

/** Kenar çubuğu grupları: günlük iş, araştırma, büro. */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    items: [
      { href: '/sohbet', icon: 'nav.chat', labelKey: 'chat' },
      { href: '/donusturucu', icon: 'action.regenerate', labelKey: 'converter' },
    ],
  },
  {
    key: 'research',
    items: [
      { href: '/karar-arsivi', icon: 'nav.decisions', labelKey: 'decisions' },
      { href: '/mevzuat', icon: 'nav.legislation', labelKey: 'legislation' },
    ],
  },
  {
    key: 'office',
    items: [
      { href: '/dosyalar', icon: 'nav.files', labelKey: 'files' },
      { href: '/belgeler', icon: 'nav.documents', labelKey: 'documents' },
      { href: '/takvim', icon: 'nav.calendar', labelKey: 'calendar' },
    ],
  },
];

export const PRIMARY_NAV: readonly NavEntry[] = NAV_GROUPS.flatMap((g) => g.items);

export const SECONDARY_NAV: readonly NavEntry[] = [
  { href: '/ayarlar', icon: 'nav.settings', labelKey: 'settings' },
];

export function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Yoldan etkin gezinme kaydı (üst çubuk başlığı için). */
export function activeEntry(pathname: string): NavEntry | undefined {
  return [...PRIMARY_NAV, ...SECONDARY_NAV].find((n) => isActive(pathname, n.href));
}
