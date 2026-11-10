// #56: sohbet karşılama dilimi ve cümle seçimi. Saf fonksiyonlar (React yok); `Date` çağrısı
// bileşende yapılır. Dilim kullanıcının yerel saatine göredir.
export type GreetingPeriod = 'morning' | 'afternoon' | 'evening' | 'night';

export const GREETING_VARIANTS = 3;

/** Saate (0–23) göre dilim: sabah 05–11, öğleden sonra 12–17, akşam 18–22, gece 23–04. */
export function greetingPeriod(hour: number): GreetingPeriod {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 23) return 'evening';
  return 'night';
}

/** Aynı gün ve dilimde hep aynı cümle (yenilemede titreme yok); `month` 1–12. */
export function greetingVariant(year: number, month: number, day: number): number {
  return (year * 372 + month * 31 + day) % GREETING_VARIANTS;
}
