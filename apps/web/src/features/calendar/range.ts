// Takvim aralık ve gün hesapları (saf; yerel saat = kullanıcının saati, Europe/Istanbul beklenir).
import type { CalendarEventDtoValue } from '@eda/contracts/api/calendar';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { isoDate, monthGrid } from './month.ts';

export type CalendarView = 'month' | 'week' | 'agenda';

const DAY_MS = 86_400_000;

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Pazartesi başlangıçlı hafta başı. */
export function weekStart(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** Görünümün sorgulanacak yarı açık aralığı [from, to). */
export function rangeOf(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === 'month') {
    const cells = monthGrid(anchor.getFullYear(), anchor.getMonth(), anchor);
    const first = cells[0]?.date ?? anchor;
    return { from: first, to: addDays(first, 42) };
  }
  if (view === 'week') {
    const from = weekStart(anchor);
    return { from, to: addDays(from, 7) };
  }
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  return { from, to: addDays(from, CONFIG_DEFAULTS['calendar.agendaWindowDays']) };
}

/** API aralık sınırı (`calendar.rangeMaxDays`) içinde kalır. */
export function withinApiRange(from: Date, to: Date): boolean {
  return to.getTime() - from.getTime() <= CONFIG_DEFAULTS['calendar.rangeMaxDays'] * DAY_MS;
}

export function shiftAnchor(view: CalendarView, anchor: Date, delta: number): Date {
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
  if (view === 'week') return addDays(anchor, 7 * delta);
  return addDays(anchor, CONFIG_DEFAULTS['calendar.agendaWindowDays'] * delta);
}

export function eventDayKey(e: CalendarEventDtoValue): string {
  return isoDate(new Date(e.startsAt));
}

/** Etkinlikleri başlangıç gününe göre gruplar; gün içinde tüm gün önce, sonra saate göre. */
export function groupByDay(
  events: readonly CalendarEventDtoValue[],
): Map<string, CalendarEventDtoValue[]> {
  const map = new Map<string, CalendarEventDtoValue[]>();
  const sorted = [...events].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  });
  for (const e of sorted) {
    const k = eventDayKey(e);
    const list = map.get(k);
    if (list) list.push(e);
    else map.set(k, [e]);
  }
  return map;
}

export const MANUAL_TYPES = [
  'hearing',
  'discovery',
  'expert',
  'meeting',
  'mediation',
  'task',
] as const;
export type ManualType = (typeof MANUAL_TYPES)[number];

/** Form girdisi -> API başlangıç/bitiş (yerel saatten ISO). */
export function toIsoRange(
  day: string,
  allDay: boolean,
  start: string,
  end: string,
): { startsAt: string; endsAt: string | null } | null {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return null;
  if (allDay) return { startsAt: new Date(y, m - 1, d, 0, 0, 0).toISOString(), endsAt: null };
  const at = (hhmm: string): Date | null => {
    const [h, mi] = hhmm.split(':').map(Number);
    if (h === undefined || mi === undefined || Number.isNaN(h) || Number.isNaN(mi)) return null;
    return new Date(y, m - 1, d, h, mi, 0);
  };
  const s = at(start);
  if (!s) return null;
  const e = end === '' ? null : at(end);
  if (end !== '' && !e) return null;
  return { startsAt: s.toISOString(), endsAt: e ? e.toISOString() : null };
}

export function timeText(e: CalendarEventDtoValue, allDayLabel: string): string {
  if (e.allDay) return allDayLabel;
  const f = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });
  const s = f.format(new Date(e.startsAt));
  return e.endsAt ? `${s}–${f.format(new Date(e.endsAt))}` : s;
}
