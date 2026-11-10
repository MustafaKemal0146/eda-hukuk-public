// @tk TK-29
// KK-P03c-10 (KK-032-13): tatil ve adli tatil veri modülleri (032 §10.4). Seed bu dizileri yazar.
import { describe, expect, it } from 'vitest';
import {
  HALF_DAY_STARTS_AT,
  HOLIDAY_YEARS,
  HOLIDAYS,
  JUDICIAL_RECESSES,
  toDateRangeLiteral,
} from '../src/holidays/index.ts';
import { readHolidayFixture } from './deadline/helpers.ts';

const HALF_DAY_CODES = ['ramazan_bayrami_arife', 'kurban_bayrami_arife', 'republic_day_eve'];

describe('KK-P03c-10: resmî tatil satırları', () => {
  it('her yıl için tam 17 satır ve her kod yılda bir kez', () => {
    for (const year of HOLIDAY_YEARS) {
      const rows = HOLIDAYS.filter((h) => h.holidayDate.startsWith(`${year}-`));
      expect(rows).toHaveLength(17);
      expect(new Set(rows.map((h) => h.code)).size).toBe(17);
    }
  });

  it('yıllar arasında kod kümesi aynıdır', () => {
    const codesOf = (year: number) =>
      HOLIDAYS.filter((h) => h.holidayDate.startsWith(`${year}-`))
        .map((h) => h.code)
        .sort();
    expect(codesOf(2027)).toEqual(codesOf(2026));
    expect(codesOf(2028)).toEqual(codesOf(2026));
  });

  it('*_arife ve republic_day_eve yarım gündür ve 13:00 başlar; diğerleri tam gündür', () => {
    expect(HALF_DAY_STARTS_AT).toBe('13:00');
    for (const h of HOLIDAYS) {
      const half = h.code.endsWith('_arife') || h.code === 'republic_day_eve';
      expect(HALF_DAY_CODES.includes(h.code)).toBe(half);
      expect(h.isHalfDay).toBe(half);
      expect(h.startsAtLocal).toBe(half ? '13:00' : null);
    }
    expect(HOLIDAYS.filter((h) => h.isHalfDay)).toHaveLength(9);
  });

  it('2027-05-19 tarihinde iki satır vardır: kurban_bayrami_4 ve youth_sports_day', () => {
    const rows = HOLIDAYS.filter((h) => h.holidayDate === '2027-05-19');
    expect(rows.map((h) => h.code).sort()).toEqual(['kurban_bayrami_4', 'youth_sports_day']);
  });

  it('plan tablosundaki dinî bayram tarihleri (032 §10.4)', () => {
    const dateOf = (code: string, year: number) =>
      HOLIDAYS.find((h) => h.code === code && h.holidayDate.startsWith(`${year}-`))?.holidayDate;
    expect(dateOf('ramazan_bayrami_arife', 2026)).toBe('2026-03-19');
    expect(dateOf('ramazan_bayrami_3', 2026)).toBe('2026-03-22');
    expect(dateOf('ramazan_bayrami_arife', 2027)).toBe('2027-03-08');
    expect(dateOf('ramazan_bayrami_1', 2028)).toBe('2028-02-26');
    expect(dateOf('ramazan_bayrami_3', 2028)).toBe('2028-02-28');
    expect(dateOf('kurban_bayrami_arife', 2026)).toBe('2026-05-26');
    expect(dateOf('kurban_bayrami_4', 2026)).toBe('2026-05-30');
    expect(dateOf('kurban_bayrami_arife', 2027)).toBe('2027-05-15');
    expect(dateOf('kurban_bayrami_arife', 2028)).toBe('2028-05-04');
    expect(dateOf('kurban_bayrami_4', 2028)).toBe('2028-05-08');
  });

  it('tarihler geçerli takvim günüdür', () => {
    for (const h of HOLIDAYS) {
      expect(new Date(`${h.holidayDate}T00:00:00Z`).toISOString().slice(0, 10)).toBe(h.holidayDate);
    }
  });

  it('dinî bayram kaynağı Diyanet, sabit tatil kaynağı 2429 s. K.', () => {
    for (const h of HOLIDAYS) {
      expect(h.source).toContain(h.kind === 'religious' ? 'Diyanet' : '2429 s. K.');
    }
    expect(HOLIDAYS.some((h) => h.kind === 'administrative_leave')).toBe(false);
  });
});

describe('KK-P03c-10: adli tatil dönemleri', () => {
  it('her satır [Y-07-20, Y-09-01) aralığıdır', () => {
    for (const r of JUDICIAL_RECESSES) {
      expect(r.period).toEqual({ start: `${r.year}-07-20`, endExclusive: `${r.year}-09-01` });
      expect(toDateRangeLiteral(r.period)).toBe(`[${r.year}-07-20,${r.year}-09-01)`);
    }
  });

  it('yalnız hmk, cmk, iyuk dalları; her dal için üç yıl', () => {
    for (const branch of ['hmk', 'cmk', 'iyuk'] as const) {
      expect(
        JUDICIAL_RECESSES.filter((r) => r.branch === branch)
          .map((r) => r.year)
          .sort(),
      ).toEqual([...HOLIDAY_YEARS]);
    }
    expect(JUDICIAL_RECESSES.some((r) => r.branch === 'iik' || r.branch === 'mediation')).toBe(
      false,
    );
  });

  it('aynı dalda dönemler çakışmaz (EXCLUDE judicial_recesses_no_overlap)', () => {
    for (const branch of new Set(JUDICIAL_RECESSES.map((r) => r.branch))) {
      const ranges = JUDICIAL_RECESSES.filter((r) => r.branch === branch)
        .map((r) => r.period)
        .sort((a, b) => (a.start < b.start ? -1 : 1));
      for (let i = 1; i < ranges.length; i++) {
        const prev = ranges[i - 1];
        const next = ranges[i];
        expect(prev?.endExclusive).not.toBeNull();
        expect((prev?.endExclusive ?? '') <= (next?.start ?? '')).toBe(true);
      }
    }
  });
});

describe('KK-P03c-10: süre motoru tatil fixture’ı seed veri modülüyle eşit (AS-0204)', () => {
  it('holidays-2026-2028.json tatil ve adli tatil satırları HOLIDAYS / JUDICIAL_RECESSES ile aynı', () => {
    const fixture = readHolidayFixture();
    const key = (d: string, c: string, n: string, k: string, h: boolean, t: string | null) =>
      `${d}|${c}|${n}|${k}|${h}|${t}`;
    expect(
      fixture.holidays
        .map((r) => key(r.date, r.code, r.name, r.kind, r.isHalfDay, r.startsAtLocal))
        .sort(),
    ).toEqual(
      HOLIDAYS.map((r) =>
        key(r.holidayDate, r.code, r.name, r.kind, r.isHalfDay, r.startsAtLocal),
      ).sort(),
    );
    expect(
      fixture.recesses.map((r) => `${r.branch}|${r.year}|${r.start}|${r.endExclusive}`).sort(),
    ).toEqual(
      JUDICIAL_RECESSES.map(
        (r) => `${r.branch}|${r.year}|${r.period.start}|${r.period.endExclusive}`,
      ).sort(),
    );
  });
});
