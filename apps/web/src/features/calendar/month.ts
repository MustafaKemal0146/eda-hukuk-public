// Ay ızgarası hesabı (saf): Pazartesi başlangıçlı 6x7 hücre; yerel tarih (Europe/Istanbul kullanıcı saati).
export type DayCell = {
  date: Date;
  inMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  key: string;
};

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthGrid(year: number, month: number, today: Date): DayCell[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Pazartesi = 0
  const start = new Date(year, month, 1 - offset);
  const todayKey = isoDate(today);
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const dow = (date.getDay() + 6) % 7;
    return {
      date,
      inMonth: date.getMonth() === month,
      isToday: isoDate(date) === todayKey,
      isWeekend: dow >= 5,
      key: isoDate(date),
    };
  });
}
