// Tatil verisi indeksi ve iş günü kuralları (083 §2.3, §5.3). Pazar her zaman tatildir; Cumartesi
// `saturdayPolicy`'ye bağlıdır (T-2). Tam resmî/dini tatil iş günü değildir; yalnız yarım gün
// (arife, 28 Ekim) ve `administrative_leave` satırı olan gün iş günüdür (T-10). Eksik veri
// sessizce "tatil yok" sayılmaz: kapsam yılları ayrıca okunur ve uyarı üretilir (İ4).
import type {
  HolidayData,
  HolidayEntry,
  RecessBranch,
  RecessEntry,
} from '../holidays/holiday-data.ts';
import { type CivilDay, fromIso, SATURDAY, SUNDAY, weekday } from './civil-date.ts';

export type SaturdayPolicy = 'shift' | 'workday';

export type RecessRange = { readonly start: CivilDay; readonly endInclusive: CivilDay };

export type CalendarIndex = {
  readonly coverageYears: ReadonlySet<number>;
  /** O günün tam (yarım olmayan) resmî/dini tatil satırları; kod sıralı. */
  fullHolidaysOn(day: CivilDay): readonly HolidayEntry[];
  /** Hafta içi ve tam tatil olmayan bir günde yarım gün satırı (`null` = yok). */
  halfDayOn(day: CivilDay, policy: SaturdayPolicy): HolidayEntry | null;
  isAdministrativeLeave(day: CivilDay): boolean;
  isWorkingDay(day: CivilDay, policy: SaturdayPolicy): boolean;
  recessOf(branch: RecessBranch, year: number): RecessRange | null;
};

export function buildCalendarIndex(data: HolidayData): CalendarIndex {
  const full = new Map<CivilDay, HolidayEntry[]>();
  const half = new Map<CivilDay, HolidayEntry>();
  const admin = new Set<CivilDay>();
  for (const h of data.holidays) {
    const day = fromIso(h.date);
    if (h.kind === 'administrative_leave') {
      admin.add(day);
    } else if (h.isHalfDay) {
      if (h.startsAtLocal === null)
        throw new Error(`Yarım gün satırında başlangıç saati yok: ${h.code}`);
      half.set(day, h);
    } else {
      const list = full.get(day) ?? [];
      list.push(h);
      full.set(day, list);
    }
  }
  for (const list of full.values())
    list.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  const recesses = new Map<string, RecessRange>();
  for (const r of data.recesses as readonly RecessEntry[]) {
    recesses.set(`${r.branch}:${r.year}`, {
      start: fromIso(r.start),
      endInclusive: fromIso(r.endInclusive),
    });
  }
  const isWeekendOff = (day: CivilDay, policy: SaturdayPolicy): boolean => {
    const wd = weekday(day);
    return wd === SUNDAY || (wd === SATURDAY && policy === 'shift');
  };
  const index: CalendarIndex = {
    coverageYears: new Set(data.coverageYears),
    fullHolidaysOn: (day) => full.get(day) ?? [],
    halfDayOn: (day, policy) => {
      if (isWeekendOff(day, policy) || full.has(day)) return null;
      return half.get(day) ?? null;
    },
    isAdministrativeLeave: (day) => admin.has(day),
    isWorkingDay: (day, policy) => !isWeekendOff(day, policy) && !full.has(day),
    recessOf: (branch, year) => recesses.get(`${branch}:${year}`) ?? null,
  };
  return index;
}
