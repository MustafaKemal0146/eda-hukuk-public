// Sivil tarih aritmetiği (083 §5.3, Kodlama Ajanı Notları 4-5). Tarih, 1970-01-01'den bu yana gün
// sayısı olan bir tamsayıdır (epoch-gün); saat dilimi ve JS tarih nesnesi kullanılmaz (K14).
// Proleptik Gregoryen takvim; dönüşüm H. Hinnant "days_from_civil" yöntemidir.

/** Epoch-gün: 1970-01-01 = 0. */
export type CivilDay = number;

export type Ymd = { readonly y: number; readonly m: number; readonly d: number };

/** Haftanın günü: 0 = Pazartesi ... 6 = Pazar (Türkiye'de hafta Pazartesi başlar). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const SATURDAY: Weekday = 5;
export const SUNDAY: Weekday = 6;

export const WEEKDAY_NAMES_TR = [
  'Pazartesi',
  'Salı',
  'Çarşamba',
  'Perşembe',
  'Cuma',
  'Cumartesi',
  'Pazar',
] as const;

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function fromYmd(y: number, m: number, d: number): CivilDay {
  const yy = m <= 2 ? y - 1 : y;
  const era = floorDiv(yy, 400);
  const yoe = yy - era * 400;
  const mp = (m + 9) % 12;
  const doy = floorDiv(153 * mp + 2, 5) + d - 1;
  const doe = yoe * 365 + floorDiv(yoe, 4) - floorDiv(yoe, 100) + doy;
  return era * 146097 + doe - 719468;
}

export function toYmd(day: CivilDay): Ymd {
  const z = day + 719468;
  const era = floorDiv(z, 146097);
  const doe = z - era * 146097;
  const yoe = floorDiv(
    doe - floorDiv(doe, 1460) + floorDiv(doe, 36524) - floorDiv(doe, 146096),
    365,
  );
  const doy = doe - (365 * yoe + floorDiv(yoe, 4) - floorDiv(yoe, 100));
  const mp = floorDiv(5 * doy + 2, 153);
  const d = doy - floorDiv(153 * mp + 2, 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return { y, m, d };
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` geçerli bir takvim günü mü (ör. 2026-02-29 değildir). */
export function isValidIso(iso: string): boolean {
  const m = ISO_RE.exec(iso);
  if (m === null) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

/** `YYYY-MM-DD` -> epoch-gün. Geçersiz tarihte `RangeError` atar (çağıran Zod ile doğrular). */
export function fromIso(iso: string): CivilDay {
  if (!isValidIso(iso)) throw new RangeError(`Geçersiz tarih: ${iso}`);
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return fromYmd(y, m, d);
}

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

export function toIso(day: CivilDay): string {
  const { y, m, d } = toYmd(day);
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}

/** `GG.AA.YYYY` (003 §4; arayüz ve hesap izi biçimi). */
export function formatTr(day: CivilDay): string {
  const { y, m, d } = toYmd(day);
  return `${pad(d, 2)}.${pad(m, 2)}.${pad(y, 4)}`;
}

const TR_RE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** `GG.AA.YYYY` -> epoch-gün; geçersizse `null`. */
export function parseTr(text: string): CivilDay | null {
  const m = TR_RE.exec(text.trim());
  if (m === null) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return isValidIso(iso) ? fromIso(iso) : null;
}

export function yearOf(day: CivilDay): number {
  return toYmd(day).y;
}

/** 1970-01-01 Perşembe'dir (3). */
export function weekday(day: CivilDay): Weekday {
  return ((((day + 3) % 7) + 7) % 7) as Weekday;
}

export function weekdayName(day: CivilDay): string {
  return WEEKDAY_NAMES_TR[weekday(day)];
}

export function addDays(day: CivilDay, n: number): CivilDay {
  return day + n;
}

/**
 * Ay ekleme: aynı gün; o ayda yoksa ayın son günü (taşma yok). 30.01 + 1 ay = 28.02;
 * 31.01.2028 + 1 ay = 29.02.2028 (083 §5.3, HMK m.92/2).
 */
export function addMonths(day: CivilDay, n: number): CivilDay {
  const { y, m, d } = toYmd(day);
  const total = y * 12 + (m - 1) + n;
  const ny = floorDiv(total, 12);
  const nm = total - ny * 12 + 1;
  return fromYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export type PeriodUnit = 'day' | 'week' | 'month';

/** Süre ekleme: `day` +n, `week` +7n, `month` ay aritmetiği (083 §5.3; T-16). */
export function addPeriod(day: CivilDay, value: number, unit: PeriodUnit): CivilDay {
  if (unit === 'day') return addDays(day, value);
  if (unit === 'week') return addDays(day, 7 * value);
  return addMonths(day, value);
}
