// Süre hesabı (083 §5.2 sözde kodu satır satır). Saf ve deterministiktir: saat, ağ, DB, rastgelelik
// okunmaz; kural, tatil verisi, mahkeme bilgisi ve yapılandırma parametre gelir (İ1, Y-09).
// Aynı girdi + aynı kural sürümü + aynı tatil verisi = bayt-bayt aynı çıktı (KK-083-13).
import type { DeadlineCalcDtoValue, DeadlineCalcReason } from '@eda/contracts/api/deadlines';
import type { DeadlineStartEvent, DeadlineWarningCode, ServiceMethod } from '@eda/contracts/enums';
import type { HolidayData, HolidayEntry } from '../holidays/holiday-data.ts';
import { buildCalendarIndex, type CalendarIndex } from './calendar.ts';
import {
  addDays,
  addPeriod,
  type CivilDay,
  fromIso,
  isValidIso,
  SATURDAY,
  toIso,
  weekday,
  yearOf,
} from './civil-date.ts';
import { toIstanbulIso } from './format.ts';
import { DeadlineEngineError, type DeadlineRuleRecordValue } from './params.ts';
import {
  contestedChainStep,
  contestedHalfDayStep,
  DEFAULT_START_EVENT_LABELS,
  type DeadlineStepOut,
  E_TEBLIGAT_DAYS,
  eTebligatStep,
  halfDayStep,
  mediationExtensionStep,
  periodStep,
  recessStep,
  shiftStep,
  startStep,
} from './steps.ts';
import { renderWarnings } from './warnings.ts';

export const ENGINE_VERSION = 'deadline-engine@1.0.0';

/** Zincir döngüsü üst sınırı (083 §5.2, Not 6); aşılırsa veri bozukluğudur. */
export const MAX_CHAIN_ROUNDS = 8;

/** Kabul edilen olay tarihi aralığı (083 §3.1 `event_date_out_of_range`). */
export const EVENT_DATE_MIN = '2000-01-01';
export const EVENT_DATE_MAX = '2100-12-31';

const END_OF_DAY = '23:59';

export type DeadlineEngineInput = {
  readonly startEvent: DeadlineStartEvent;
  /** `YYYY-MM-DD`; e-tebligatta gönderim/ulaşma tarihi. */
  readonly eventDate: string;
  readonly serviceMethod: ServiceMethod | null;
};

export type DeadlineEngineContext = {
  readonly rule: DeadlineRuleRecordValue;
  readonly holidays: HolidayData;
  /** Mahkeme bilinmiyorsa `null`; `adminRecessExempt` yalnız İYUK kurallarında okunur (§5.5). */
  readonly court: { readonly adminRecessExempt: boolean } | null;
  readonly config: { readonly officeCloseTime: string };
  /** `prod`: yalnız doğrulanmış kural. `preview`: yalnız dev/test + bayrak (çağıran denetler). */
  readonly mode: 'prod' | 'preview';
};

export type DeadlineCalcFailure =
  | { readonly ok: false; readonly code: 'DEADLINE_RULE_UNVERIFIED' }
  | { readonly ok: false; readonly code: 'VALIDATION_FAILED'; readonly reason: DeadlineCalcReason };

export type DeadlineCalcResult =
  | { readonly ok: true; readonly value: DeadlineCalcDtoValue }
  | DeadlineCalcFailure;

/** Kural seçilebilir mi (083 İ3, §10; Y-80). */
export function isRuleSelectable(rule: DeadlineRuleRecordValue, mode: 'prod' | 'preview'): boolean {
  if (rule.supersededAt !== null) return false;
  return mode === 'preview' || rule.verifiedBy !== null;
}

/** Aynı tatil verisi nesnesi için indeks bir kez kurulur (saf önbellek; veri değişmez kabul edilir). */
const INDEX_CACHE = new WeakMap<HolidayData, CalendarIndex>();

function calendarFor(data: HolidayData): CalendarIndex {
  let idx = INDEX_CACHE.get(data);
  if (idx === undefined) {
    idx = buildCalendarIndex(data);
    INDEX_CACHE.set(data, idx);
  }
  return idx;
}

function invalid(reason: DeadlineCalcReason): DeadlineCalcFailure {
  return { ok: false, code: 'VALIDATION_FAILED', reason };
}

function inEffect(rule: DeadlineRuleRecordValue, day: CivilDay): boolean {
  const { start, endExclusive } = rule.effectiveDuring;
  if (day < fromIso(start)) return false;
  return endExclusive === null || day < fromIso(endExclusive);
}

type Shift = { to: CivilDay; applied: HolidayEntry[]; anyHoliday: boolean; sawSaturday: boolean };

/** Sonraki iş gününe kaydırma (083 §5.2 iç döngü). İş günündeyse `null`. */
function shiftToWorkingDay(
  cal: CalendarIndex,
  from: CivilDay,
  policy: 'shift' | 'workday',
): Shift | null {
  if (cal.isWorkingDay(from, policy)) return null;
  const applied: HolidayEntry[] = [];
  let anyHoliday = false;
  let sawSaturday = false;
  let e = from;
  while (!cal.isWorkingDay(e, policy)) {
    if (weekday(e) === SATURDAY) sawSaturday = true;
    for (const h of cal.fullHolidaysOn(e)) {
      applied.push(h);
      anyHoliday = true;
    }
    e = addDays(e, 1);
  }
  return { to: e, applied, anyHoliday, sawSaturday };
}

/**
 * 083 §5.2 `calculateDeadline`. Kural ve girdi hataları sonuç değeridir; veri bozukluğu
 * (`DeadlineEngineError`) fırlatılır ve sessizce devam edilmez.
 */
export function calculateDeadline(
  input: DeadlineEngineInput,
  ctx: DeadlineEngineContext,
): DeadlineCalcResult {
  const { rule } = ctx;
  const p = rule.params;

  // 0. Seçilebilirlik ve girdi doğrulama (083 §3.1; sıra §5.2 ile aynı).
  if (!isRuleSelectable(rule, ctx.mode)) return { ok: false, code: 'DEADLINE_RULE_UNVERIFIED' };
  if (!rule.startEvents.includes(input.startEvent)) return invalid('start_event_not_allowed');
  if (input.serviceMethod !== null && input.startEvent !== 'service') {
    return invalid('service_method_not_applicable');
  }
  if (
    !isValidIso(input.eventDate) ||
    input.eventDate < EVENT_DATE_MIN ||
    input.eventDate > EVENT_DATE_MAX
  ) {
    return invalid('event_date_out_of_range');
  }
  const eventDay = fromIso(input.eventDate);
  if (!inEffect(rule, eventDay)) return invalid('rule_not_effective');

  const cal = calendarFor(ctx.holidays);
  const steps: DeadlineStepOut[] = [];
  const warnings = new Set<DeadlineWarningCode>();
  const applied: HolidayEntry[] = [];
  const officeClose = ctx.config.officeCloseTime;
  const endTime = p.endTime === 'office_close' ? officeClose : END_OF_DAY;

  const serviceMethodDefaulted = input.startEvent === 'service' && input.serviceMethod === null;
  const serviceMethod: ServiceMethod | null =
    input.startEvent === 'service' ? (input.serviceMethod ?? 'postal') : null;

  // 1. Tebliğ günü (e-tebligat: olay + 5; kaydırma yok, T-8).
  let s = eventDay;
  if (serviceMethod === 'e_tebligat') {
    s = addDays(eventDay, E_TEBLIGAT_DAYS);
    steps.push(eTebligatStep(eventDay, s));
  }
  const labelOverride = p.startEventLabels[input.startEvent];
  steps.push(
    startStep({
      branch: rule.branch,
      startEvent: input.startEvent,
      labelOverride,
      serviceMethod,
      serviceMethodDefaulted,
      day: s,
    }),
  );

  // 2. Ham bitiş.
  const rawEnd = addPeriod(s, rule.durationValue, rule.durationUnit);
  let e = rawEnd;
  const exempt =
    rule.recessApplies && p.recessBranch === 'iyuk' && ctx.court?.adminRecessExempt === true;
  steps.push(
    periodStep({
      branch: rule.branch,
      lawRef: rule.lawRef,
      period: { value: rule.durationValue, unit: rule.durationUnit },
      end: e,
      exemptNote: exempt,
    }),
  );

  // 3. Zincir döngüsü: adli tatil uzaması ve tatil/hafta sonu kaydırması aynı döngüde (G08, G17).
  let preChain: CivilDay | null = null;
  let shifted = false;
  let recessApplied = false;
  let settled = false;
  for (let round = 1; round <= MAX_CHAIN_ROUNDS; round++) {
    let changed = false;
    if (rule.recessApplies && !exempt && p.recessBranch !== null && p.recessExtension !== null) {
      const recess = cal.recessOf(p.recessBranch, yearOf(e));
      if (recess !== null && e >= recess.start && e <= recess.endInclusive) {
        if (shifted && preChain === null) preChain = e; // T-6
        const before = e;
        e = addPeriod(recess.endInclusive, p.recessExtension.value, p.recessExtension.unit);
        steps.push(
          recessStep({
            recessBranch: p.recessBranch,
            before,
            recessEnd: recess.endInclusive,
            extension: p.recessExtension,
            after: e,
          }),
        );
        recessApplied = true;
        changed = true;
      }
    }
    if (p.holidayShift === 'next_working_day') {
      const sh = shiftToWorkingDay(cal, e, p.saturdayPolicy);
      if (sh !== null) {
        if (sh.sawSaturday) warnings.add('saturday_shift');
        applied.push(...sh.applied);
        steps.push(
          shiftStep({
            branch: rule.branch,
            from: e,
            fromHolidays: cal.fullHolidaysOn(e),
            to: sh.to,
            anyHoliday: sh.anyHoliday,
          }),
        );
        e = sh.to;
        shifted = true;
        changed = true;
      }
    }
    if (!changed) {
      settled = true;
      break;
    }
  }
  if (!settled) {
    throw new DeadlineEngineError(
      'chain_limit_exceeded',
      `Süre zinciri ${MAX_CHAIN_ROUNDS} turda sonuçlanmadı (tatil verisi bozuk olabilir).`,
    );
  }

  // 4. Arife (yarım gün) ve zincir: çift tarih (İ5, T-1, T-6).
  let dueDay = e;
  let dueAt = toIstanbulIso(e, endTime);
  let safeDueAt: string | null = null;
  let contestedDay: CivilDay | null = null;
  const halfDay = p.holidayShift === 'next_working_day' ? cal.halfDayOn(e, p.saturdayPolicy) : null;
  if (halfDay !== null) {
    safeDueAt = toIstanbulIso(e, halfDay.startsAtLocal ?? endTime);
    // Tatili izleyen ilk iş günü: aynı kaydırma kuralı; uyarı ve `appliedHolidays` üretmez (§6.2).
    const next = addDays(e, 1);
    contestedDay = shiftToWorkingDay(cal, next, p.saturdayPolicy)?.to ?? next;
    steps.push(halfDayStep(e, halfDay));
    steps.push(
      contestedHalfDayStep({ branch: rule.branch, contested: contestedDay, endTime: p.endTime }),
    );
    warnings.add('half_day');
    warnings.add('contested_extension');
    dueAt = safeDueAt;
  } else if (preChain !== null && p.recessBranch !== null) {
    safeDueAt = toIstanbulIso(preChain, endTime);
    contestedDay = e;
    steps.push(
      contestedChainStep({
        recessBranch: p.recessBranch,
        safe: preChain,
        contested: e,
        endTime: p.endTime,
      }),
    );
    warnings.add('contested_extension');
    dueDay = preChain;
    dueAt = safeDueAt;
  }

  // 5. Uyarılar: veri kapsamı, idari izin, önizleme.
  const lastDay = contestedDay !== null && contestedDay > dueDay ? contestedDay : dueDay;
  const lastConsidered = e > lastDay ? e : lastDay;
  const missingYears: number[] = [];
  for (let y = yearOf(s); y <= yearOf(lastConsidered); y++) {
    const holidayMissing = !cal.coverageYears.has(y);
    const recessMissing =
      rule.recessApplies && p.recessBranch !== null && cal.recessOf(p.recessBranch, y) === null;
    if (holidayMissing || recessMissing) missingYears.push(y);
  }
  if (missingYears.length > 0) warnings.add('holiday_data_missing');
  for (let d = addDays(s, 1); d <= lastConsidered; d = addDays(d, 1)) {
    if (cal.isAdministrativeLeave(d)) {
      warnings.add('administrative_leave');
      break;
    }
  }
  if (ctx.mode === 'preview' && rule.verifiedBy === null) warnings.add('rule_unverified_preview');
  if (p.optionalExtension !== null) {
    steps.push(
      mediationExtensionStep({
        extension: p.optionalExtension,
        until: addPeriod(dueDay, p.optionalExtension.value, p.optionalExtension.unit),
        lawRef: rule.lawRef,
      }),
    );
  }

  const appliedHolidays = applied
    .map((h) => ({ date: h.date, code: h.code, name: h.name }))
    .sort((a, b) =>
      a.date === b.date
        ? a.code < b.code
          ? -1
          : a.code > b.code
            ? 1
            : 0
        : a.date < b.date
          ? -1
          : 1,
    );

  // Sabit anahtar sırası (bayt eşitliği; KK-083-13).
  const value: DeadlineCalcDtoValue = {
    ruleCode: rule.code,
    ruleVersion: rule.version,
    ruleTitle: rule.title,
    lawRef: rule.lawRef,
    verifiedBy: rule.verifiedBy,
    verifiedAt: rule.verifiedAt,
    periodNature: p.periodNature,
    startEvent: input.startEvent,
    startEventLabel: labelOverride ?? DEFAULT_START_EVENT_LABELS[input.startEvent],
    eventDate: toIso(eventDay),
    effectiveServiceDate: toIso(s),
    serviceMethod,
    dueDate: toIso(dueDay),
    dueAt,
    safeDueAt,
    contestedDueDate: contestedDay === null ? null : toIso(contestedDay),
    steps,
    appliedHolidays,
    recessApplied,
    warnings: renderWarnings(warnings, missingYears),
    engineVersion: ENGINE_VERSION,
    meta: {
      officeCloseTime: officeClose,
      saturdayPolicy: p.saturdayPolicy,
      holidayDataFingerprint: ctx.holidays.fingerprint,
      coverageYears: [...ctx.holidays.coverageYears],
      rulePublishedParams: p,
    },
  };
  return { ok: true, value };
}
