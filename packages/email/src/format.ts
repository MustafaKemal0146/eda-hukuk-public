// Tarih biçimleri (045 §4.1, Tuzak 14): her zaman `Europe/Istanbul` ve `tr-TR`; sunucu saat dilimine
// bağlı `toLocale*` kullanılmaz. Çıktı `GG.AA.YYYY SS:DD`.
const TZ = 'Europe/Istanbul';

const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const DATE = new Intl.DateTimeFormat('tr-TR', {
  timeZone: TZ,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

function parts(f: Intl.DateTimeFormat, d: Date): Record<string, string> {
  return Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
}

/** `GG.AA.YYYY SS:DD` (Europe/Istanbul). */
export function formatDateTime(value: Date | string): string {
  const p = parts(DATE_TIME, new Date(value));
  return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`;
}

/** `GG.AA.YYYY` (Europe/Istanbul). */
export function formatDate(value: Date | string): string {
  const p = parts(DATE, new Date(value));
  return `${p.day}.${p.month}.${p.year}`;
}
