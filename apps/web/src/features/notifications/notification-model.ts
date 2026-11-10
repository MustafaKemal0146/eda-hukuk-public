// Bildirim kutusu modeli (saf): tür → derin bağlantı, sayı biçimi. İçerik (başlık, taraf adı) yoktur;
// panel yalnız tür etiketi ve zaman gösterir (Y-63, 045 §4).
import type { NotificationDtoValue } from '@eda/contracts/api/notifications';

type Type = NotificationDtoValue['type'];

const LINKS: Readonly<Partial<Record<Type, string>>> = {
  reminder: '/takvim',
  deadline_due: '/takvim',
  file_ready: '/dosyalar',
  file_failed: '/dosyalar',
  export_ready: '/belgeler',
  kunye_check_ready: '/sohbet',
  invitation: '/ayarlar',
  verification_approved: '/ayarlar',
  verification_rejected: '/ayarlar',
};

/** Tür için uygulama içi sabit bağlantı; yoksa `null` (bağlantı payload'dan üretilmez). */
export function linkFor(type: Type): string | null {
  return LINKS[type] ?? null;
}

/** Zil rozeti: 0 gizli, 99'dan fazlası "99+". */
export function badgeText(unread: number): string | null {
  if (unread <= 0) return null;
  return unread > 99 ? '99+' : String(unread);
}

/** Önceki sayfaya yenisini ekler; aynı kimlik tekrarlanmaz. */
export function mergePages(
  prev: readonly NotificationDtoValue[],
  next: readonly NotificationDtoValue[],
): NotificationDtoValue[] {
  const seen = new Set(prev.map((n) => n.id));
  return [...prev, ...next.filter((n) => !seen.has(n.id))];
}
