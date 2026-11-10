// @tk TK-14
// Tatil fixture'ı ve motor verisi (083 §8, 032 §10.4; KK-083-15). Haftanın günü sütunu 083 §8
// tablosundan aynen alınır ve takvimle karşılaştırılır (belgenin kendi tutarlılık denetimi).
import { describe, expect, it } from 'vitest';
import { buildCalendarIndex, fromIso, weekday } from '../../src/deadline-engine/index.ts';
import { holidayDataContent } from '../../src/holidays/index.ts';
import { holidayData, readHolidayFixture } from './helpers.ts';

const W = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'] as const;

// 083 §8 tablosu: kod -> yıl -> [GG.AA, gün kısaltması].
const TABLE_083: Readonly<Record<string, Readonly<Record<number, readonly [string, string]>>>> = {
  new_year: { 2026: ['01.01', 'Per'], 2027: ['01.01', 'Cum'], 2028: ['01.01', 'Cmt'] },
  ramazan_bayrami_arife: { 2026: ['19.03', 'Per'], 2027: ['08.03', 'Pzt'], 2028: ['25.02', 'Cum'] },
  ramazan_bayrami_1: { 2026: ['20.03', 'Cum'], 2027: ['09.03', 'Sal'], 2028: ['26.02', 'Cmt'] },
  ramazan_bayrami_3: { 2026: ['22.03', 'Paz'], 2027: ['11.03', 'Per'], 2028: ['28.02', 'Pzt'] },
  national_sovereignty_day: {
    2026: ['23.04', 'Per'],
    2027: ['23.04', 'Cum'],
    2028: ['23.04', 'Paz'],
  },
  labour_day: { 2026: ['01.05', 'Cum'], 2027: ['01.05', 'Cmt'], 2028: ['01.05', 'Pzt'] },
  youth_sports_day: { 2026: ['19.05', 'Sal'], 2027: ['19.05', 'Çar'], 2028: ['19.05', 'Cum'] },
  kurban_bayrami_arife: { 2026: ['26.05', 'Sal'], 2027: ['15.05', 'Cmt'], 2028: ['04.05', 'Per'] },
  kurban_bayrami_1: { 2026: ['27.05', 'Çar'], 2027: ['16.05', 'Paz'], 2028: ['05.05', 'Cum'] },
  kurban_bayrami_4: { 2026: ['30.05', 'Cmt'], 2027: ['19.05', 'Çar'], 2028: ['08.05', 'Pzt'] },
  democracy_day: { 2026: ['15.07', 'Çar'], 2027: ['15.07', 'Per'], 2028: ['15.07', 'Cmt'] },
  victory_day: { 2026: ['30.08', 'Paz'], 2027: ['30.08', 'Pzt'], 2028: ['30.08', 'Çar'] },
  republic_day_eve: { 2026: ['28.10', 'Çar'], 2027: ['28.10', 'Per'], 2028: ['28.10', 'Cmt'] },
  republic_day: { 2026: ['29.10', 'Per'], 2027: ['29.10', 'Cum'], 2028: ['29.10', 'Paz'] },
};

// 083 §8 adli tatil tablosu: yıl -> [başlangıç günü, bitiş (31.08) günü, 01.09 günü].
const RECESS_083: Readonly<Record<number, readonly [string, string, string]>> = {
  2026: ['Pzt', 'Pzt', 'Sal'],
  2027: ['Sal', 'Sal', 'Çar'],
  2028: ['Per', 'Per', 'Cum'],
};

describe('KK-P22-14 (KK-083-15) tatil seed fixture: 51 + 9 ve 083 §8 tarihleri birebir', () => {
  const fx = readHolidayFixture();

  it('51 tatil satırı (17 x 3), 9 adli tatil satırı (3 dal x 3 yıl)', () => {
    expect(fx.holidays).toHaveLength(51);
    expect(fx.recesses).toHaveLength(9);
    for (const y of [2026, 2027, 2028]) {
      expect(fx.holidays.filter((h) => h.date.startsWith(`${y}-`))).toHaveLength(17);
      expect(
        fx.recesses
          .filter((r) => r.year === y)
          .map((r) => r.branch)
          .sort(),
      ).toEqual(['cmk', 'hmk', 'iyuk']);
    }
    // `(tarih, kod)` tekil; 2027-05-19 iki kod (083 §8 notu).
    const keys = new Set(fx.holidays.map((h) => `${h.date}:${h.code}`));
    expect(keys.size).toBe(51);
    expect(
      fx.holidays
        .filter((h) => h.date === '2027-05-19')
        .map((h) => h.code)
        .sort(),
    ).toEqual(['kurban_bayrami_4', 'youth_sports_day']);
  });

  it('083 §8 tarihleri ve haftanın günleri birebir', () => {
    for (const [code, years] of Object.entries(TABLE_083)) {
      for (const [y, [ddmm, wd]] of Object.entries(years)) {
        const [dd, mm] = ddmm.split('.');
        const iso = `${y}-${mm}-${dd}`;
        expect(
          fx.holidays.some((h) => h.code === code && h.date === iso),
          `${code} ${iso}`,
        ).toBe(true);
        expect(W[weekday(fromIso(iso))], `${code} ${iso}`).toBe(wd);
      }
    }
    for (const [y, [start, end, next]] of Object.entries(RECESS_083)) {
      expect(W[weekday(fromIso(`${y}-07-20`))]).toBe(start);
      expect(W[weekday(fromIso(`${y}-08-31`))]).toBe(end);
      expect(W[weekday(fromIso(`${y}-09-01`))]).toBe(next);
    }
  });

  it("yarım gün satırları 13:00; kind kümesi; administrative_leave seed'de yok", () => {
    const half = fx.holidays.filter((h) => h.isHalfDay);
    expect(half.map((h) => h.code).sort()).toEqual(
      [2026, 2027, 2028]
        .flatMap(() => ['kurban_bayrami_arife', 'ramazan_bayrami_arife', 'republic_day_eve'])
        .sort(),
    );
    for (const h of fx.holidays) {
      expect(h.isHalfDay === (h.startsAtLocal === '13:00')).toBe(true);
      expect(['official', 'religious']).toContain(h.kind);
    }
  });

  it('adli tatil yarı açık [20.07, 01.09): motor kapalı üst sınırı 31.08 okur (083 Not 12)', () => {
    const data = holidayData(fx);
    expect(data.recesses.every((r) => r.endInclusive.endsWith('-08-31'))).toBe(true);
    const cal = buildCalendarIndex(data);
    const r = cal.recessOf('hmk', 2026);
    expect(r).toEqual({ start: fromIso('2026-07-20'), endInclusive: fromIso('2026-08-31') });
    expect(cal.recessOf('hmk', 2029)).toBeNull();
  });

  it('kapsama yılları new_year satırından; iik/mediation dal satırı yok sayılır', () => {
    const data = holidayDataContent(
      fx.holidays.filter((h) => !(h.code === 'new_year' && h.date.startsWith('2028'))),
      [
        ...fx.recesses,
        { branch: 'iik', year: 2026, start: '2026-07-20', endExclusive: '2026-09-01' },
      ],
    );
    expect(data.coverageYears).toEqual([2026, 2027]);
    expect(data.recesses).toHaveLength(9);
  });

  it('iş günü kuralları: Pazar hayır; Cumartesi politikaya bağlı; arife iş günü ama yarım', () => {
    const cal = buildCalendarIndex(holidayData(fx));
    expect(cal.isWorkingDay(fromIso('2026-03-22'), 'workday')).toBe(false); // Pazar
    expect(cal.isWorkingDay(fromIso('2026-03-14'), 'shift')).toBe(false); // Cumartesi
    expect(cal.isWorkingDay(fromIso('2026-03-14'), 'workday')).toBe(true);
    expect(cal.isWorkingDay(fromIso('2026-03-19'), 'shift')).toBe(true); // arife
    expect(cal.halfDayOn(fromIso('2026-03-19'), 'shift')?.code).toBe('ramazan_bayrami_arife');
    expect(cal.halfDayOn(fromIso('2027-05-15'), 'shift')).toBeNull(); // Cumartesi arifesi
    expect(cal.isWorkingDay(fromIso('2026-03-20'), 'shift')).toBe(false); // bayram
  });
});
