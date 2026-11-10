// @tk TK-14
// Sivil tarih aritmetiği (083 §5.3; KK-083-9). Bağımsız denetim için test tarafında UTC
// milisaniye aritmetiği kullanılır (motor kaynağında kullanılmaz).
import { describe, expect, it } from 'vitest';
import {
  addMonths,
  addPeriod,
  formatTr,
  fromIso,
  isValidIso,
  parseTr,
  toIso,
  weekday,
  weekdayName,
} from '../../src/deadline-engine/index.ts';

describe('KK-P22-9 (KK-083-9) sivil tarih ve ay aritmetiği', () => {
  it('1900-2200 arası her gün: ISO gidiş-dönüş ve haftanın günü UTC ile aynı', () => {
    const start = Date.UTC(1900, 0, 1);
    const end = Date.UTC(2200, 11, 31);
    for (let t = start; t <= end; t += 86_400_000) {
      const iso = new Date(t).toISOString().slice(0, 10);
      const d = fromIso(iso);
      if (toIso(d) !== iso || d !== t / 86_400_000) expect.fail(iso);
      if (weekday(d) !== (new Date(t).getUTCDay() + 6) % 7) expect.fail(`gün ${iso}`);
    }
  });

  it('ay sonu sıkıştırma; taşma yok', () => {
    expect(toIso(addMonths(fromIso('2026-01-30'), 1))).toBe('2026-02-28');
    expect(toIso(addMonths(fromIso('2026-03-31'), 1))).toBe('2026-04-30');
    expect(toIso(addMonths(fromIso('2028-01-31'), 1))).toBe('2028-02-29');
    expect(toIso(addMonths(fromIso('2026-12-15'), 1))).toBe('2027-01-15');
    expect(toIso(addMonths(fromIso('2026-02-28'), 12))).toBe('2027-02-28');
    expect(toIso(addMonths(fromIso('2028-02-29'), 12))).toBe('2029-02-28');
    expect(toIso(addPeriod(fromIso('2026-03-05'), 2, 'week'))).toBe('2026-03-19');
    expect(toIso(addPeriod(fromIso('2026-03-16'), 60, 'day'))).toBe('2026-05-15');
  });

  it('GG.AA.YYYY biçimi, ayrıştırma ve geçersiz tarih', () => {
    expect(formatTr(fromIso('2026-03-05'))).toBe('05.03.2026');
    expect(parseTr('05.03.2026')).toBe(fromIso('2026-03-05'));
    expect(parseTr('29.02.2026')).toBeNull();
    expect(parseTr('2026-03-05')).toBeNull();
    expect(isValidIso('2028-02-29')).toBe(true);
    expect(isValidIso('2100-02-29')).toBe(false);
    expect(() => fromIso('2026-13-01')).toThrow(RangeError);
    expect(weekdayName(fromIso('2026-03-19'))).toBe('Perşembe');
  });
});
