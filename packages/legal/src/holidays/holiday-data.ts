// Süre motorunun tatil girdisi (083 §2.3-§2.4). Motor DB'ye bağlanmaz: `apps/api` yükleyicisi
// `holidays` ve `judicial_recesses` satırlarını okuyup bu biçime çevirir ve parmak izini
// (`node:crypto` sha256, ilk 16 hex) hesaplayıp hazır dize olarak verir (P22 K3).
import type { HolidayKind } from '@eda/contracts/enums';
import { addDays, fromIso, toIso } from '../deadline-engine/civil-date.ts';
import { canonicalJson } from '../deadline-engine/format.ts';

export type RecessBranch = 'hmk' | 'cmk' | 'iyuk';

export type HolidayEntry = {
  readonly date: string;
  readonly code: string;
  readonly name: string;
  readonly kind: HolidayKind;
  readonly isHalfDay: boolean;
  readonly startsAtLocal: string | null;
};

export type RecessEntry = {
  readonly branch: RecessBranch;
  readonly year: number;
  readonly start: string;
  /** Kapalı üst sınır: `period.upper - 1 gün` (= 31 Ağustos; 083 §2.3, Not 12). */
  readonly endInclusive: string;
};

export type HolidayData = {
  /** Yıl Y kapsanır <=> o yıl için `new_year` kodlu bir tatil satırı vardır (083 §2.4). */
  readonly coverageYears: readonly number[];
  readonly holidays: readonly HolidayEntry[];
  readonly recesses: readonly RecessEntry[];
  readonly fingerprint: string;
};

/** `judicial_recesses` satırı: `period = [start, endExclusive)` (yarı açık, 030 §5). */
export type RecessRowInput = {
  readonly branch: string;
  readonly year: number;
  readonly start: string;
  readonly endExclusive: string;
};

/** Kapsama yılını belirleyen tatil kodu (083 §2.4). */
export const COVERAGE_HOLIDAY_CODE = 'new_year';

function isRecessBranch(b: string): b is RecessBranch {
  return b === 'hmk' || b === 'cmk' || b === 'iyuk';
}

/**
 * Satırlardan parmak izsiz motor verisi üretir: tatiller (tarih, kod) sıralı, adli tatiller
 * (yıl, dal) sıralı ve kapalı üst sınırlı; `iik`/`mediation` dal satırı yok sayılır.
 */
export function holidayDataContent(
  holidays: readonly HolidayEntry[],
  recesses: readonly RecessRowInput[],
): Omit<HolidayData, 'fingerprint'> {
  const sortedHolidays = [...holidays]
    .map((h) => ({
      date: h.date,
      code: h.code,
      name: h.name,
      kind: h.kind,
      isHalfDay: h.isHalfDay,
      startsAtLocal: h.startsAtLocal,
    }))
    .sort((a, b) => (a.date === b.date ? cmp(a.code, b.code) : cmp(a.date, b.date)));
  const sortedRecesses: RecessEntry[] = [];
  for (const r of recesses) {
    if (!isRecessBranch(r.branch)) continue;
    sortedRecesses.push({
      branch: r.branch,
      year: r.year,
      start: r.start,
      endInclusive: toIso(addDays(fromIso(r.endExclusive), -1)),
    });
  }
  sortedRecesses.sort((a, b) => (a.year === b.year ? cmp(a.branch, b.branch) : a.year - b.year));
  const coverage = new Set<number>();
  for (const h of sortedHolidays) {
    if (h.code === COVERAGE_HOLIDAY_CODE) coverage.add(Number(h.date.slice(0, 4)));
  }
  return {
    coverageYears: [...coverage].sort((a, b) => a - b),
    holidays: sortedHolidays,
    recesses: sortedRecesses,
  };
}

/** Parmak izinin girdisi: kanonik JSON (anahtar sıralı). Özet `apps/api`'de alınır (K3). */
export function holidayDataCanonicalJson(content: Omit<HolidayData, 'fingerprint'>): string {
  return canonicalJson(content);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
