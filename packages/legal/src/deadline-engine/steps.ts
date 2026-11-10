// Hesap izi adımları (083 §6.1): Türkçe sabit şablon notları ve dayanak atıfları. Atıflar 083 §4.1-§4.5
// tablolarından ve §6.1 örneklerinden alınmıştır; belgede atıf yoksa `null` yazılır (uydurma yok).
// Metinler Hukuk onayı bekliyor.
import type { DeadlineBranch, DeadlineStartEvent, DeadlineStepKind } from '@eda/contracts/enums';
import type { HolidayEntry, RecessBranch } from '../holidays/holiday-data.ts';
import {
  type CivilDay,
  formatTr,
  SATURDAY,
  SUNDAY,
  toIso,
  weekday,
  weekdayName,
} from './civil-date.ts';

export type DeadlineStepOut = {
  kind: DeadlineStepKind;
  date: string | null;
  note: string;
  legalBasis: string | null;
};

type PeriodLike = { value: number; unit: 'day' | 'week' | 'month' };

const UNIT_TR: Readonly<Record<PeriodLike['unit'], string>> = {
  day: 'gün',
  week: 'hafta',
  month: 'ay',
};

export function periodText(p: PeriodLike): string {
  return `${p.value} ${UNIT_TR[p.unit]}`;
}

/** Varsayılan olay etiketi (083 §3.2 `startEventLabel`). */
export const DEFAULT_START_EVENT_LABELS: Readonly<Record<DeadlineStartEvent, string>> = {
  service: 'Tebliğ tarihi',
  pronouncement: 'Tefhim tarihi',
  learning: 'Öğrenme tarihi',
};

const START_EVENT_NOUN: Readonly<Record<DeadlineStartEvent, string>> = {
  service: 'tebliğ',
  pronouncement: 'tefhim',
  learning: 'öğrenme',
};

// ---------- Dayanak atıfları (083 §4) ----------

const START_BASIS: Readonly<Record<DeadlineBranch, string | null>> = {
  hmk: 'HMK m.92/1',
  cmk: 'CMK m.39/1',
  iyuk: 'İYUK m.8/1',
  iik: 'İİK m.19',
  mediation: null,
};

function periodBasis(
  branch: DeadlineBranch,
  unit: PeriodLike['unit'],
  lawRef: string,
): string | null {
  switch (branch) {
    case 'hmk':
      return unit === 'day' ? 'HMK m.92/1' : 'HMK m.92/2';
    case 'cmk':
      return unit === 'day' ? 'CMK m.39/1' : 'CMK m.39/2-3';
    case 'iyuk':
      return unit === 'day' ? 'İYUK m.8/1' : null;
    case 'iik':
      return 'İİK m.19';
    case 'mediation':
      return lawRef;
  }
}

/** Kaydırma dayanağı; arabuluculuğa başvuru süresi HMK m.93 gibi kaydırılır (T-13, `P-MED-BASVURU`). */
const SHIFT_BASIS: Readonly<Record<DeadlineBranch, string>> = {
  hmk: 'HMK m.93',
  cmk: 'CMK m.39/4',
  iyuk: 'İYUK m.8/2',
  iik: 'İİK m.19',
  mediation: 'HMK m.93',
};

const RECESS_BASIS: Readonly<Record<RecessBranch, string>> = {
  hmk: 'HMK m.104',
  cmk: 'CMK m.331/4',
  iyuk: 'İYUK m.8/3',
};

const RECESS_NOUN: Readonly<Record<RecessBranch, string>> = {
  hmk: 'adli tatil',
  cmk: 'adli tatil',
  iyuk: 'çalışmaya ara verme',
};

const RECESS_NOUN_GEN: Readonly<Record<RecessBranch, string>> = {
  hmk: 'adli tatilin',
  cmk: 'adli tatilin',
  iyuk: 'çalışmaya ara vermenin',
};

export const E_TEBLIGAT_BASIS = 'Tebligat K. m.7/a';
export const HALF_DAY_BASIS = '2429 s. K. m.2';
export const E_TEBLIGAT_DAYS = 5;

// ---------- Adım üreticileri ----------

function dayWithName(day: CivilDay): string {
  return `${formatTr(day)} (${weekdayName(day)})`;
}

export function eTebligatStep(eventDay: CivilDay, serviceDay: CivilDay): DeadlineStepOut {
  return {
    kind: 'e_tebligat',
    date: toIso(serviceDay),
    note: `E-tebligat gönderimi ${formatTr(eventDay)}; izleyen ${E_TEBLIGAT_DAYS}. günün sonunda (${formatTr(serviceDay)}) tebliğ yapılmış sayılır.`,
    legalBasis: E_TEBLIGAT_BASIS,
  };
}

export function startStep(args: {
  branch: DeadlineBranch;
  startEvent: DeadlineStartEvent;
  labelOverride: string | undefined;
  serviceMethod: 'postal' | 'e_tebligat' | null;
  serviceMethodDefaulted: boolean;
  day: CivilDay;
}): DeadlineStepOut {
  let what = `${START_EVENT_NOUN[args.startEvent]} ${formatTr(args.day)}`;
  if (args.labelOverride !== undefined) what = `${args.labelOverride} ${formatTr(args.day)}`;
  let method = '';
  if (args.serviceMethod === 'postal') {
    method = args.serviceMethodDefaulted
      ? ' (posta; yöntem belirtilmediği için varsayıldı)'
      : ' (posta)';
  } else if (args.serviceMethod === 'e_tebligat') {
    method = ' (e-tebligat)';
  }
  return {
    kind: 'start',
    date: toIso(args.day),
    note: `Başlangıç: ${what}${method}. Başlangıç günü hesaba katılmaz.`,
    legalBasis: START_BASIS[args.branch],
  };
}

export function periodStep(args: {
  branch: DeadlineBranch;
  lawRef: string;
  period: PeriodLike;
  end: CivilDay;
  exemptNote: boolean;
}): DeadlineStepOut {
  const exempt = args.exemptNote
    ? ' Çalışmaya ara vermeyen yer (İYUK m.61); ara verme uzaması uygulanmaz.'
    : '';
  return {
    kind: 'period',
    date: toIso(args.end),
    note: `Süre: ${periodText(args.period)} → ${dayWithName(args.end)}.${exempt}`,
    legalBasis: periodBasis(args.branch, args.period.unit, args.lawRef),
  };
}

export function recessStep(args: {
  recessBranch: RecessBranch;
  before: CivilDay;
  recessEnd: CivilDay;
  extension: PeriodLike;
  after: CivilDay;
}): DeadlineStepOut {
  const noun = RECESS_NOUN[args.recessBranch];
  return {
    kind: 'recess_extension',
    date: toIso(args.after),
    note: `Süre ${noun} içinde bitiyor (${formatTr(args.before)}); ${RECESS_NOUN_GEN[args.recessBranch]} bittiği günden (${formatTr(args.recessEnd)}) itibaren ${periodText(args.extension)} uzar → ${formatTr(args.after)}.`,
    legalBasis: RECESS_BASIS[args.recessBranch],
  };
}

export function shiftStep(args: {
  branch: DeadlineBranch;
  from: CivilDay;
  fromHolidays: readonly HolidayEntry[];
  to: CivilDay;
  anyHoliday: boolean;
}): DeadlineStepOut {
  const parts = args.fromHolidays.map((h) => h.name);
  const wd = weekday(args.from);
  if (wd === SATURDAY || wd === SUNDAY) parts.push(weekdayName(args.from));
  const what = parts.join(' ve ');
  if (args.anyHoliday) {
    return {
      kind: 'holiday_shift',
      date: toIso(args.to),
      note: `Son gün ${formatTr(args.from)} ${what}; tatili izleyen ilk iş günü ${dayWithName(args.to)}.`,
      legalBasis: SHIFT_BASIS[args.branch],
    };
  }
  return {
    kind: 'weekend_shift',
    date: toIso(args.to),
    note: `Son gün ${formatTr(args.from)} ${what}; sonraki iş günü ${dayWithName(args.to)}.`,
    legalBasis: SHIFT_BASIS[args.branch],
  };
}

export function halfDayStep(day: CivilDay, entry: HolidayEntry): DeadlineStepOut {
  return {
    kind: 'half_day',
    date: toIso(day),
    note: `Son gün ${formatTr(day)} yarım gün tatildir: ${entry.name} (${entry.startsAtLocal ?? ''}'ten sonra tatil).`,
    legalBasis: HALF_DAY_BASIS,
  };
}

function endTimeText(endTime: 'office_close' | 'end_of_day'): string {
  return endTime === 'office_close' ? 'çalışma saati sonu' : '23:59';
}

export function contestedHalfDayStep(args: {
  branch: DeadlineBranch;
  contested: CivilDay;
  endTime: 'office_close' | 'end_of_day';
}): DeadlineStepOut {
  return {
    kind: 'contested_extension',
    date: toIso(args.contested),
    note: `Tartışmalı uzama: tatili izleyen ilk iş günü ${formatTr(args.contested)} ${endTimeText(args.endTime)}.`,
    legalBasis: SHIFT_BASIS[args.branch],
  };
}

export function contestedChainStep(args: {
  recessBranch: RecessBranch;
  safe: CivilDay;
  contested: CivilDay;
  endTime: 'office_close' | 'end_of_day';
}): DeadlineStepOut {
  const noun = RECESS_NOUN[args.recessBranch];
  return {
    kind: 'contested_extension',
    date: toIso(args.contested),
    note: `Tartışmalı uzama: kaydırılan son gün ${formatTr(args.safe)} ${noun} dönemine denk geliyor; uzama uygulanırsa ${formatTr(args.contested)} ${endTimeText(args.endTime)}.`,
    legalBasis: RECESS_BASIS[args.recessBranch],
  };
}

export function mediationExtensionStep(args: {
  extension: PeriodLike;
  until: CivilDay;
  lawRef: string;
}): DeadlineStepOut {
  return {
    kind: 'mediation_extension',
    date: toIso(args.until),
    note: `Arabulucu zorunlu hâlde süreyi en fazla ${periodText(args.extension)} uzatabilir → ${formatTr(args.until)}.`,
    legalBasis: args.lawRef,
  };
}
