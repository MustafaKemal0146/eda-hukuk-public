// Takvim aralık ve form dönüşümleri (saf fonksiyonlar).
import { describe, expect, it } from 'vitest';
import {
  addDays,
  groupByDay,
  rangeOf,
  toIsoRange,
  weekStart,
  withinApiRange,
} from '../src/features/calendar/range.ts';

describe('takvim aralığı', () => {
  it('ay görünümü 42 gün, Pazartesi başlar ve api sınırı içindedir', () => {
    const { from, to } = rangeOf('month', new Date(2026, 9, 1));
    expect(from.getDay()).toBe(1);
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(42);
    expect(withinApiRange(from, to)).toBe(true);
  });

  it('hafta Pazartesi başlar', () => {
    expect(weekStart(new Date(2026, 9, 11)).getDate()).toBe(5); // Pazar 11 Ekim -> Pazartesi 5 Ekim
    expect(addDays(new Date(2026, 9, 30), 3).getMonth()).toBe(10);
  });

  it('form girdisi: tüm gün bitişsiz, saatli bitiş doğrulanır', () => {
    const all = toIsoRange('2026-10-15', true, '', '');
    expect(all?.endsAt).toBeNull();
    const timed = toIsoRange('2026-10-15', false, '10:00', '11:30');
    expect(new Date(timed?.endsAt ?? 0).getTime() - new Date(timed?.startsAt ?? 0).getTime()).toBe(
      90 * 60_000,
    );
    expect(toIsoRange('bozuk', false, '10:00', '')).toBeNull();
  });

  it('gün içinde tüm gün önce, sonra saate göre sıralar', () => {
    const base = {
      caseId: null,
      deadlineId: null,
      userId: 'u',
      location: null,
      courtCode: null,
      esasNo: null,
      notes: null,
      endsAt: null,
      timezone: 'Europe/Istanbul',
      completedAt: null,
      cancelledAt: null,
      reminders: [],
      type: 'task' as const,
    };
    const day = (h: number) => new Date(2026, 9, 15, h).toISOString();
    const map = groupByDay([
      { ...base, id: 'b', title: 'b', startsAt: day(14), allDay: false },
      { ...base, id: 'a', title: 'a', startsAt: day(9), allDay: false },
      { ...base, id: 'c', title: 'c', startsAt: day(0), allDay: true },
    ]);
    expect([...(map.get('2026-10-15') ?? [])].map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});
