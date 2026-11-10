// Süre motoru ve süre kayıtları sözleşmeleri (083 §2.2, §3; 041 §2.4, §6.2, §6.5; P22.2).
// Süreyi yalnız `@eda/legal` süre motoru hesaplar (Y-09); bu dosya yalnız şekilleri tanımlar.
import { z } from 'zod';
import {
  DEADLINE_ACKNOWLEDGEMENTS,
  DEADLINE_BRANCHES,
  DEADLINE_PERIOD_UNITS,
  DEADLINE_START_EVENTS,
  DEADLINE_STATUSES,
  DEADLINE_STEP_KINDS,
  DEADLINE_WARNING_CODES,
  HOLIDAY_KINDS,
  PERIOD_NATURES,
  SERVICE_METHODS,
} from '../enums.ts';
import { ReminderSpecList } from './calendar.ts';

const IsoDate = z.iso.date();
const IsoDateTime = z.iso.datetime({ offset: true });

/** Kural kodu deseni (030 §5 `deadline_rules.code` CHECK; 083 §3.1). */
export const DEADLINE_RULE_CODE_RE = /^[a-z0-9_]{3,64}$/;

// ---------- Kural parametreleri (083 §2.2) ----------

/** Adli tatil tablosunda aranabilen dallar (`judicial_recesses`; `iik`, `mediation` satırı yoktur). */
export const RECESS_BRANCHES = ['hmk', 'cmk', 'iyuk'] as const;
export const HOLIDAY_SHIFT_POLICIES = ['next_working_day', 'none'] as const;
export const SATURDAY_POLICIES = ['shift', 'workday'] as const;
export const END_TIME_POLICIES = ['office_close', 'end_of_day'] as const;

export const DeadlinePeriod = z.strictObject({
  value: z.number().int().positive(),
  unit: z.enum(['day', 'week']),
});
export type DeadlinePeriodValue = z.infer<typeof DeadlinePeriod>;

/**
 * `deadline_rules.params` (083 §2.2). Tüm anahtarlar zorunludur; örtük varsayılan yoktur.
 * `recess_applies` kolonu ile tutarlılık satır düzeyinde `DeadlineRuleRecord` doğrular.
 */
export const DeadlineRuleParams = z.strictObject({
  startNextDay: z.literal(true),
  holidayShift: z.enum(HOLIDAY_SHIFT_POLICIES),
  saturdayPolicy: z.enum(SATURDAY_POLICIES),
  endTime: z.enum(END_TIME_POLICIES),
  recessBranch: z.enum(RECESS_BRANCHES).nullable(),
  recessExtension: DeadlinePeriod.nullable(),
  optionalExtension: DeadlinePeriod.nullable(),
  periodNature: z.enum(PERIOD_NATURES),
  startEventLabels: z.partialRecord(z.enum(DEADLINE_START_EVENTS), z.string().min(1).max(60)),
  aliases: z.array(z.string().min(2).max(60)).min(1).max(12),
});
export type DeadlineRuleParamsValue = z.infer<typeof DeadlineRuleParams>;

/**
 * Motorun okuduğu kural satırı (`app.deadline_rules`, 030 §5; 083 §2.1). `effectiveDuring` yarı
 * açık aralıktır: `[start, endExclusive)`; `endExclusive = null` üst sınırsızdır.
 * Satır kuralı (083 §2.2 superRefine): `recessApplies` <=> `recessBranch` ve `recessExtension` dolu.
 */
export const DeadlineRuleRecord = z
  .strictObject({
    code: z.string().regex(DEADLINE_RULE_CODE_RE),
    version: z.number().int().min(1),
    branch: z.enum(DEADLINE_BRANCHES),
    title: z.string().min(1),
    lawRef: z.string().min(1),
    durationValue: z.number().int().positive(),
    durationUnit: z.enum(DEADLINE_PERIOD_UNITS),
    startEvents: z.array(z.enum(DEADLINE_START_EVENTS)).min(1),
    recessApplies: z.boolean(),
    params: DeadlineRuleParams,
    effectiveDuring: z.strictObject({ start: IsoDate, endExclusive: IsoDate.nullable() }),
    verifiedBy: z.string().min(1).nullable(),
    verifiedAt: IsoDateTime.nullable(),
    supersededAt: IsoDateTime.nullable(),
  })
  .superRefine((r, ctx) => {
    const recessFilled = r.params.recessBranch !== null && r.params.recessExtension !== null;
    if (r.recessApplies !== recessFilled) {
      ctx.addIssue({
        code: 'custom',
        path: ['params', 'recessBranch'],
        message:
          'Adli tatil uygulanan kuralda recessBranch ve recessExtension birlikte dolu olmalıdır; uygulanmayan kuralda ikisi de boş olmalıdır.',
      });
    }
    if ((r.verifiedBy === null) !== (r.verifiedAt === null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['verifiedBy'],
        message: 'Doğrulayan ve doğrulama tarihi birlikte dolu ya da birlikte boş olmalıdır.',
      });
    }
  });
export type DeadlineRuleRecordValue = z.infer<typeof DeadlineRuleRecord>;

// ---------- Hesap girdisi ve çıktısı (083 §3) ----------

/** `POST /deadlines/calculate` gövdesi (083 §3.1 aynen). */
export const DeadlineCalcInput = z.strictObject({
  ruleCode: z.string().regex(DEADLINE_RULE_CODE_RE),
  startEvent: z.enum(DEADLINE_START_EVENTS),
  eventDate: IsoDate,
  serviceMethod: z.enum(SERVICE_METHODS).nullable(),
  caseId: z.uuid().nullable(),
  courtCode: z.string().nullable(),
});
export type DeadlineCalcInputValue = z.infer<typeof DeadlineCalcInput>;

/** Hesap girdisi doğrulama nedenleri (`VALIDATION_FAILED.reason`; 002 §20, 083 §3.1). */
export const DEADLINE_CALC_REASONS = [
  'start_event_not_allowed',
  'service_method_not_applicable',
  'event_date_out_of_range',
  'rule_not_effective',
  'court_unknown',
] as const;
export type DeadlineCalcReason = (typeof DEADLINE_CALC_REASONS)[number];

export const DeadlineStep = z.strictObject({
  kind: z.enum(DEADLINE_STEP_KINDS),
  date: IsoDate.nullable(),
  note: z.string(),
  legalBasis: z.string().nullable(),
});
export type DeadlineStepValue = z.infer<typeof DeadlineStep>;

export const AppliedHoliday = z.strictObject({ date: IsoDate, code: z.string(), name: z.string() });

export const DeadlineWarning = z.strictObject({
  code: z.enum(DEADLINE_WARNING_CODES),
  message: z.string(),
});

/** 083 §3.2 `meta`: yeniden üretilebilirlik bilgisi (`deadlines.calculation.meta`). */
export const DeadlineCalcMeta = z.strictObject({
  officeCloseTime: z.string().regex(/^\d{2}:\d{2}$/),
  saturdayPolicy: z.enum(SATURDAY_POLICIES),
  holidayDataFingerprint: z.string(),
  coverageYears: z.array(z.number().int()),
  rulePublishedParams: DeadlineRuleParams,
});

/**
 * Süre motoru çıktısı (041 §2.4 + 083 §3.2 ek alanları). `verifiedBy`/`verifiedAt` yalnız
 * önizleme kipinde (doğrulanmamış kural, `rule_unverified_preview`) boştur; prod'da doludur.
 */
export const DeadlineCalcDto = z.strictObject({
  ruleCode: z.string(),
  ruleVersion: z.number().int(),
  ruleTitle: z.string(),
  lawRef: z.string(),
  verifiedBy: z.string().nullable(),
  verifiedAt: IsoDateTime.nullable(),
  periodNature: z.enum(PERIOD_NATURES),
  startEvent: z.enum(DEADLINE_START_EVENTS),
  startEventLabel: z.string(),
  eventDate: IsoDate,
  effectiveServiceDate: IsoDate,
  serviceMethod: z.enum(SERVICE_METHODS).nullable(),
  dueDate: IsoDate,
  dueAt: IsoDateTime,
  safeDueAt: IsoDateTime.nullable(),
  contestedDueDate: IsoDate.nullable(),
  steps: z.array(DeadlineStep),
  appliedHolidays: z.array(AppliedHoliday),
  recessApplied: z.boolean(),
  warnings: z.array(DeadlineWarning),
  engineVersion: z.string(),
  meta: DeadlineCalcMeta,
});
export type DeadlineCalcDtoValue = z.infer<typeof DeadlineCalcDto>;

// ---------- Kural, kayıt ve tatil DTO'ları (041 §6.5) ----------

export const DeadlineRuleDto = z.strictObject({
  code: z.string(),
  version: z.number().int(),
  branch: z.enum(DEADLINE_BRANCHES),
  title: z.string(),
  lawRef: z.string(),
  durationValue: z.number().int(),
  durationUnit: z.enum(DEADLINE_PERIOD_UNITS),
  startEvents: z.array(z.enum(DEADLINE_START_EVENTS)),
  startEventLabels: z.partialRecord(z.enum(DEADLINE_START_EVENTS), z.string()),
  periodNature: z.enum(PERIOD_NATURES),
  verifiedBy: z.string(),
  verifiedAt: IsoDateTime,
});
export type DeadlineRuleDtoValue = z.infer<typeof DeadlineRuleDto>;

/**
 * `POST /deadlines` gövdesi (083 §11.1, 041 §6.5). Hesap sonucu (son gün) şemada YOKTUR: sunucu
 * hesabı yeniden yapar (KK-083-17).
 */
export const DeadlineInput = DeadlineCalcInput.extend({
  sourceFileId: z.uuid().nullable().optional(),
  evidenceQuote: z.string().max(2000).nullable().optional(),
  title: z.string().min(1).max(200).nullable().optional(),
  reminders: ReminderSpecList.optional(),
  acknowledgements: z.array(z.enum(DEADLINE_ACKNOWLEDGEMENTS)),
});
export type DeadlineInputValue = z.infer<typeof DeadlineInput>;

/** `PATCH /deadlines/:deadlineId` (041 §6.5): ya durum ya hesap girdileri; birlikte gönderilmez. */
export const DeadlinePatchInput = z.union([
  z.strictObject({ status: z.enum(DEADLINE_STATUSES) }),
  z.strictObject({
    startEvent: z.enum(DEADLINE_START_EVENTS).optional(),
    eventDate: IsoDate.optional(),
    serviceMethod: z.enum(SERVICE_METHODS).nullable().optional(),
    acknowledgements: z.array(z.enum(DEADLINE_ACKNOWLEDGEMENTS)).optional(),
  }),
]);
export type DeadlinePatchInputValue = z.infer<typeof DeadlinePatchInput>;

export const DeadlineDto = z.strictObject({
  id: z.uuid(),
  caseId: z.uuid().nullable(),
  sourceFileId: z.uuid().nullable(),
  ruleId: z.uuid(),
  ruleCode: z.string(),
  ruleVersion: z.number().int(),
  ruleTitle: z.string(),
  startEvent: z.enum(DEADLINE_START_EVENTS),
  eventDate: IsoDate,
  serviceMethod: z.enum(SERVICE_METHODS).nullable(),
  dueDate: IsoDate,
  dueAt: IsoDateTime,
  safeDueAt: IsoDateTime.nullable(),
  contestedDueDate: IsoDate.nullable(),
  status: z.enum(DEADLINE_STATUSES),
  evidenceQuote: z.string().nullable(),
  approvedBy: z.uuid().nullable(),
  approvedAt: IsoDateTime,
  filedDeclaredAt: IsoDateTime.nullable(),
  calendarEventId: z.uuid().nullable(),
  calculation: DeadlineCalcDto.pick({
    steps: true,
    appliedHolidays: true,
    recessApplied: true,
    warnings: true,
    engineVersion: true,
  }),
});
export type DeadlineDtoValue = z.infer<typeof DeadlineDto>;

export const HolidayDto = z.strictObject({
  date: IsoDate,
  code: z.string(),
  name: z.string(),
  kind: z.enum(HOLIDAY_KINDS),
  isHalfDay: z.boolean(),
  startsAtLocal: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable(),
});
export type HolidayDtoValue = z.infer<typeof HolidayDto>;

export const RecessDto = z.strictObject({
  branch: z.enum(DEADLINE_BRANCHES),
  year: z.number().int(),
  startDate: IsoDate,
  endDateExclusive: IsoDate,
  legalBasis: z.string(),
});
export type RecessDtoValue = z.infer<typeof RecessDto>;

export const HolidaysDto = z.strictObject({
  holidays: z.array(HolidayDto),
  recesses: z.array(RecessDto),
  coverageYears: z.array(z.number().int()),
});
export type HolidaysDtoValue = z.infer<typeof HolidaysDto>;
