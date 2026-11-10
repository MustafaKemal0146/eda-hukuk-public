// Resmî tatil kataloğu 2026–2028 (032 §10.4 tablosu; 083 §8 ile birebir). Yıl başına 17 satır × 3 yıl
// = 51 satır. `app.holidays` seed'inin tek kaynağıdır. Hukuk onayı bekliyor.
// Kaynak: dinî bayram tarihleri Diyanet İşleri Başkanlığı dinî günler listesi (2026-10-09'da okundu);
// sabit tatiller 2429 s. K. (S5 §4.3). Adlar 083 §8 ve S5 §4.3 tablolarındaki etiketlerdir.
//
// Alan -> kolon eşlemesi (030 §5, `app.holidays`):
//   holidayDate -> holiday_date, code -> code, name -> name, kind -> kind,
//   isHalfDay -> is_half_day, startsAtLocal -> starts_at_local, legalBasis -> legal_basis,
//   source -> source. `id`, `created_at` DB varsayılanıdır; `verified_by` / `verified_at` seed'de NULL.
import { HOLIDAY_KINDS } from '@eda/contracts/enums';
import { z } from 'zod';
import { deepFreeze, IsoDateString, LocalTimeString } from '../../catalog-common.ts';

/** `holidays_code_chk` deseni (030 §5). */
export const HOLIDAY_CODE_PATTERN = /^[a-z0-9_]{3,64}$/;

/** Yarım gün tatillerin başlangıç saati (2429 s. K.; 032 §10.4). */
export const HALF_DAY_STARTS_AT = '13:00';

export const HOLIDAY_YEARS = [2026, 2027, 2028] as const;

export const HolidayRowSchema = z
  .strictObject({
    holidayDate: IsoDateString,
    code: z.string().regex(HOLIDAY_CODE_PATTERN),
    name: z.string().min(1),
    kind: z.enum(HOLIDAY_KINDS),
    isHalfDay: z.boolean(),
    startsAtLocal: LocalTimeString.nullable(),
    legalBasis: z.string().min(1).nullable(),
    source: z.string().min(1),
  })
  // `holidays_half_day_chk`: is_half_day = (starts_at_local IS NOT NULL).
  .refine((r) => r.isHalfDay === (r.startsAtLocal !== null), {
    message: 'Yarım gün işareti ile başlangıç saati birlikte dolu ya da birlikte boş olmalıdır.',
  });

export type HolidayRow = Readonly<z.infer<typeof HolidayRowSchema>>;

const SOURCE_STATUTE = '2429 s. K.';
const SOURCE_DIYANET = "Diyanet İşleri Başkanlığı dinî günler listesi (2026-10-09'da okundu)";
const LEGAL_BASIS = '2429 s. K.';

type HolidayKind = (typeof HOLIDAY_KINDS)[number];
type Year = (typeof HOLIDAY_YEARS)[number];

/** 032 §10.4 tablo satırı: kod, tür, yarım gün, yıl başına `GG.AA` tarihi. */
type PlanRow = {
  code: string;
  name: string;
  kind: Exclude<HolidayKind, 'administrative_leave'>;
  halfDay: boolean;
  dates: Record<Year, string>;
};

// 032 §10.4 tablosu; tarihler `GG.AA` biçimindedir ve plan hücresinden aynen alınmıştır.
const PLAN_TABLE: readonly PlanRow[] = [
  {
    code: 'new_year',
    name: 'Yılbaşı',
    kind: 'official',
    halfDay: false,
    dates: { 2026: '01.01', 2027: '01.01', 2028: '01.01' },
  },
  {
    code: 'national_sovereignty_day',
    name: '23 Nisan',
    kind: 'official',
    halfDay: false,
    dates: { 2026: '23.04', 2027: '23.04', 2028: '23.04' },
  },
  {
    code: 'labour_day',
    name: '1 Mayıs',
    kind: 'official',
    halfDay: false,
    dates: { 2026: '01.05', 2027: '01.05', 2028: '01.05' },
  },
  {
    code: 'youth_sports_day',
    name: '19 Mayıs',
    kind: 'official',
    halfDay: false,
    dates: { 2026: '19.05', 2027: '19.05', 2028: '19.05' },
  },
  {
    code: 'democracy_day',
    name: '15 Temmuz',
    kind: 'official',
    halfDay: false,
    dates: { 2026: '15.07', 2027: '15.07', 2028: '15.07' },
  },
  {
    code: 'victory_day',
    name: '30 Ağustos',
    kind: 'official',
    halfDay: false,
    dates: { 2026: '30.08', 2027: '30.08', 2028: '30.08' },
  },
  {
    code: 'republic_day_eve',
    name: 'Cumhuriyet Bayramı (28 Ekim, yarım gün)',
    kind: 'official',
    halfDay: true,
    dates: { 2026: '28.10', 2027: '28.10', 2028: '28.10' },
  },
  {
    code: 'republic_day',
    name: 'Cumhuriyet Bayramı (29 Ekim)',
    kind: 'official',
    halfDay: false,
    dates: { 2026: '29.10', 2027: '29.10', 2028: '29.10' },
  },
  {
    code: 'ramazan_bayrami_arife',
    name: 'Ramazan Bayramı arifesi',
    kind: 'religious',
    halfDay: true,
    dates: { 2026: '19.03', 2027: '08.03', 2028: '25.02' },
  },
  {
    code: 'ramazan_bayrami_1',
    name: 'Ramazan Bayramı 1. gün',
    kind: 'religious',
    halfDay: false,
    dates: { 2026: '20.03', 2027: '09.03', 2028: '26.02' },
  },
  {
    code: 'ramazan_bayrami_2',
    name: 'Ramazan Bayramı 2. gün',
    kind: 'religious',
    halfDay: false,
    dates: { 2026: '21.03', 2027: '10.03', 2028: '27.02' },
  },
  {
    code: 'ramazan_bayrami_3',
    name: 'Ramazan Bayramı 3. gün',
    kind: 'religious',
    halfDay: false,
    dates: { 2026: '22.03', 2027: '11.03', 2028: '28.02' },
  },
  {
    code: 'kurban_bayrami_arife',
    name: 'Kurban Bayramı arifesi',
    kind: 'religious',
    halfDay: true,
    dates: { 2026: '26.05', 2027: '15.05', 2028: '04.05' },
  },
  {
    code: 'kurban_bayrami_1',
    name: 'Kurban Bayramı 1. gün',
    kind: 'religious',
    halfDay: false,
    dates: { 2026: '27.05', 2027: '16.05', 2028: '05.05' },
  },
  {
    code: 'kurban_bayrami_2',
    name: 'Kurban Bayramı 2. gün',
    kind: 'religious',
    halfDay: false,
    dates: { 2026: '28.05', 2027: '17.05', 2028: '06.05' },
  },
  {
    code: 'kurban_bayrami_3',
    name: 'Kurban Bayramı 3. gün',
    kind: 'religious',
    halfDay: false,
    dates: { 2026: '29.05', 2027: '18.05', 2028: '07.05' },
  },
  {
    code: 'kurban_bayrami_4',
    name: 'Kurban Bayramı 4. gün',
    kind: 'religious',
    halfDay: false,
    dates: { 2026: '30.05', 2027: '19.05', 2028: '08.05' },
  },
];

function isoFromPlan(year: Year, ddmm: string): string {
  const [dd, mm] = ddmm.split('.');
  return `${year}-${mm}-${dd}`;
}

function buildRows(): HolidayRow[] {
  const rows: HolidayRow[] = [];
  for (const year of HOLIDAY_YEARS) {
    for (const p of PLAN_TABLE) {
      rows.push({
        holidayDate: isoFromPlan(year, p.dates[year]),
        code: p.code,
        name: p.name,
        kind: p.kind,
        isHalfDay: p.halfDay,
        startsAtLocal: p.halfDay ? HALF_DAY_STARTS_AT : null,
        legalBasis: LEGAL_BASIS,
        source: p.kind === 'religious' ? SOURCE_DIYANET : SOURCE_STATUTE,
      });
    }
  }
  return rows;
}

/** 51 satır; yıl sırasıyla, yıl içinde 032 §10.4 tablo sırasıyla. */
export const HOLIDAYS: readonly HolidayRow[] = deepFreeze(buildRows());
