// Duyuru şeridi modeli (saf): ciddiyet -> ton/rol eşlemesi ve oturum içi kapatma kaydı. Duyuru metni
// düz metindir; arayüz yalnız metin düğümü olarak çizer , burada işlenmez.
import type { AnnouncementDtoValue } from '@eda/contracts/api/announcements';

export type StripTone = 'info' | 'warning' | 'danger';

export const SEVERITY_TONE: Readonly<Record<AnnouncementDtoValue['severity'], StripTone>> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

/** Kritik duyuru ekran okuyucuya hemen duyurulur (`alert`); diğerleri nazik durum bildirimidir. */
export function roleFor(severity: AnnouncementDtoValue['severity']): 'status' | 'alert' {
  return severity === 'critical' ? 'alert' : 'status';
}

export const DISMISSED_STORAGE_KEY = 'eda:announcements:dismissed';

/** Kayıtlı kimlik listesini okur; bozuk veya erişilemeyen depoda boş küme (şerit yine çizilir). */
export function readDismissed(storage: Pick<Storage, 'getItem'> | null): ReadonlySet<string> {
  try {
    const raw = storage?.getItem(DISMISSED_STORAGE_KEY) ?? null;
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

/** Kimliği kapatılanlara ekler; yalnız etkin duyuruların kimliği tutulur (liste şişmez). */
export function writeDismissed(
  storage: Pick<Storage, 'setItem'> | null,
  dismissed: ReadonlySet<string>,
  activeIds: readonly string[],
): void {
  try {
    const keep = [...dismissed].filter((id) => activeIds.includes(id));
    storage?.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(keep));
  } catch {
    // Depo kapalı olabilir (gizli pencere): kapatma yalnız bu sayfa ömrü boyunca geçerli kalır.
  }
}

export function visibleOf(
  items: readonly AnnouncementDtoValue[],
  dismissed: ReadonlySet<string>,
): AnnouncementDtoValue[] {
  return items.filter((a) => !dismissed.has(a.id));
}
