// Tatil verisi (083 §2.3-§2.4): süre motorunun tatil girdisi tipi ve satırlardan kurucu.

// Tatil ve adli tatil seed verisi (032 §10.4; tek kaynak, @eda/db seed eşler).
export {
  type DateRange,
  DateRangeSchema,
  IsoDateString,
  LocalTimeString,
  toDateRangeLiteral,
} from '../catalog-common.ts';
export {
  HALF_DAY_STARTS_AT,
  HOLIDAY_CODE_PATTERN,
  HOLIDAY_YEARS,
  HOLIDAYS,
  type HolidayRow,
  HolidayRowSchema,
} from './data/holidays.ts';
export {
  JUDICIAL_RECESSES,
  type JudicialRecessRow,
  JudicialRecessRowSchema,
} from './data/judicial-recesses.ts';
export {
  COVERAGE_HOLIDAY_CODE,
  type HolidayData,
  type HolidayEntry,
  holidayDataCanonicalJson,
  holidayDataContent,
  type RecessBranch,
  type RecessEntry,
  type RecessRowInput,
} from './holiday-data.ts';
