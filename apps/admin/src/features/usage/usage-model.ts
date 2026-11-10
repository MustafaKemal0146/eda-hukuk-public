// Kullanım ekranı saf yardımcıları (tarayıcıdan bağımsız, birim testli): İstanbul takvim günü, aralık
// doğrulaması, micro-USD dönüşümü ve payların hesabı. Gün sınırı sunucuda da Europe/Istanbul'dur.

export const MAX_RANGE_DAYS = 92;
export const PRESET_DAYS = [7, 30, 90] as const;
export type PresetDays = (typeof PRESET_DAYS)[number];

const DAY_MS = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Verilen anın Europe/Istanbul takvim günü (YYYY-MM-DD). */
export function istanbulDay(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

const dayNumber = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** `iso` gününden `delta` gün sonrası (UTC takvim aritmetiği; saat dilimi kayması yok). */
export function addDays(iso: string, delta: number): string {
  return new Date((dayNumber(iso) + delta) * DAY_MS).toISOString().slice(0, 10);
}

/** Bugün dahil son `days` günün aralığı. */
export function presetRange(days: PresetDays, now: Date): { from: string; to: string } {
  const to = istanbulDay(now);
  return { from: addDays(to, -(days - 1)), to };
}

export type RangeProblem = 'invalid' | 'order' | 'tooLong';

/** Aralık geçerliyse null; aksi sorun kodu (sunucudaki 92 gün farkı sınırı ile aynı). */
export function rangeProblem(from: string, to: string): RangeProblem | null {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return 'invalid';
  if (Number.isNaN(dayNumber(from)) || Number.isNaN(dayNumber(to))) return 'invalid';
  if (dayNumber(from) > dayNumber(to)) return 'order';
  if (dayNumber(to) - dayNumber(from) > MAX_RANGE_DAYS) return 'tooLong';
  return null;
}

export const microToUsd = (micro: number): number => micro / 1_000_000;

/** Payı 0..1 arasında verir (bölen 0 ise 0). */
export const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pozitif tamsayı girdisi (limit değeri); aksi null. */
export function parseLimitValue(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d{1,16}$/.test(s)) return null;
  const v = Number(s);
  return Number.isSafeInteger(v) && v >= 1 ? v : null;
}
