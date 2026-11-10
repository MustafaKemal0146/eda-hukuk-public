// `app` katalogları (030 §5): mahkeme, daire, dava türü, süre kuralı, tatil, adli tatil. RLS K;
// satırlar yalnız seed ile yazılır, silinmez (`is_active = false`). `judicial_recesses` EXCLUDE kısıtı
// ve ad kolonlarının tr-TR-x-icu harmanlaması migrasyonda yamadır (030 §1.9).
import {
  CHAMBER_KINDS,
  COURT_TYPES_DB,
  DEADLINE_BRANCHES,
  DEADLINE_PERIOD_UNITS,
  DEADLINE_START_EVENTS,
  HOLIDAY_KINDS,
  SENSITIVE_TOPIC_CODES,
} from '@eda/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  text,
  time,
  unique,
} from 'drizzle-orm/pg-core';
import { inList } from '../_checks.ts';
import { arraySubset, col, createdAt, idV7, tstz, updatedAt } from '../_columns.ts';
import { daterange } from '../_types.ts';
import { appSchema } from './partners.ts';

const codeCheck = (table: string, pattern: string) =>
  check(`${table}_code_chk`, sql`${col('code')} ~ ${sql.raw(`'${pattern}'`)}`);
const CATALOG_CODE = '^[a-z0-9._-]{2,64}$';
const RULE_CODE = '^[a-z0-9_]{3,64}$';

export const courts = appSchema.table(
  'courts',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    courtType: text('court_type').notNull(),
    city: text('city'),
    district: text('district'),
    courtNumber: integer('court_number'),
    adminRecessExempt: boolean('admin_recess_exempt').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    codeCheck('courts', CATALOG_CODE),
    inList('courts', t.courtType, COURT_TYPES_DB),
    index('courts_type_city_idx').on(t.courtType, t.city),
  ],
);

export const chambers = appSchema.table(
  'chambers',
  {
    code: text('code').primaryKey(),
    courtCode: text('court_code')
      .notNull()
      .references(() => courts.code),
    name: text('name').notNull(),
    shortName: text('short_name').notNull(),
    chamberKind: text('chamber_kind').notNull(),
    number: integer('number'),
    activeDuring: daterange('active_during'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    codeCheck('chambers', CATALOG_CODE),
    inList('chambers', t.chamberKind, CHAMBER_KINDS),
    index('chambers_court_idx').on(t.courtCode),
  ],
);

export const caseTypes = appSchema.table(
  'case_types',
  {
    code: text('code').primaryKey(),
    name: text('name').notNull(),
    branch: text('branch'),
    legalBasis: text('legal_basis'),
    sensitiveTopic: text('sensitive_topic'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    codeCheck('case_types', CATALOG_CODE),
    inList('case_types', t.branch, DEADLINE_BRANCHES),
    inList('case_types', t.sensitiveTopic, SENSITIVE_TOPIC_CODES),
  ],
);

/** Sürümlü süre kuralları: doğrulanmış satır değişmez, düzeltme yeni `version` (083). */
export const deadlineRules = appSchema.table(
  'deadline_rules',
  {
    id: idV7(),
    code: text('code').notNull(),
    version: integer('version').notNull(),
    branch: text('branch').notNull(),
    title: text('title').notNull(),
    lawRef: text('law_ref').notNull(),
    lawNo: text('law_no'),
    articleNo: text('article_no'),
    durationValue: integer('duration_value').notNull(),
    durationUnit: text('duration_unit').notNull(),
    startEvents: text('start_events').array().notNull(),
    recessApplies: boolean('recess_applies').notNull().default(true),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    effectiveDuring: daterange('effective_during').notNull(),
    verifiedBy: text('verified_by'),
    verifiedAt: tstz('verified_at'),
    supersededAt: tstz('superseded_at'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [
    codeCheck('deadline_rules', RULE_CODE),
    check('deadline_rules_version_chk', sql`${col('version')} >= 1`),
    inList('deadline_rules', t.branch, DEADLINE_BRANCHES),
    check('deadline_rules_duration_value_chk', sql`${col('duration_value')} > 0`),
    inList('deadline_rules', t.durationUnit, DEADLINE_PERIOD_UNITS),
    arraySubset('deadline_rules', t.startEvents, DEADLINE_START_EVENTS),
    check('deadline_rules_start_events_nonempty_chk', sql`cardinality(${col('start_events')}) > 0`),
    unique('deadline_rules_code_version_uq').on(t.code, t.version),
    unique('deadline_rules_id_version_uq').on(t.id, t.version),
    check(
      'deadline_rules_verified_chk',
      sql`(${col('verified_by')} IS NULL) = (${col('verified_at')} IS NULL)`,
    ),
    index('deadline_rules_selectable_idx')
      .on(t.branch, t.code)
      .where(sql`${col('verified_at')} IS NOT NULL AND ${col('superseded_at')} IS NULL`),
  ],
);

export const holidays = appSchema.table(
  'holidays',
  {
    id: idV7(),
    holidayDate: date('holiday_date', { mode: 'string' }).notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    isHalfDay: boolean('is_half_day').notNull().default(false),
    startsAtLocal: time('starts_at_local'),
    legalBasis: text('legal_basis'),
    source: text('source').notNull(),
    verifiedBy: text('verified_by'),
    verifiedAt: tstz('verified_at'),
    createdAt: createdAt(),
  },
  (t) => [
    codeCheck('holidays', RULE_CODE),
    inList('holidays', t.kind, HOLIDAY_KINDS),
    unique('holidays_date_code_uq').on(t.holidayDate, t.code),
    check(
      'holidays_half_day_chk',
      sql`${col('is_half_day')} = (${col('starts_at_local')} IS NOT NULL)`,
    ),
    index('holidays_date_idx').on(t.holidayDate),
  ],
);

/** Adli tatil / ara verme dönemleri; aynı kolda çakışma EXCLUDE ile yasak (migrasyon yaması). */
export const judicialRecesses = appSchema.table(
  'judicial_recesses',
  {
    id: idV7(),
    branch: text('branch').notNull(),
    year: integer('year').notNull(),
    period: daterange('period').notNull(),
    legalBasis: text('legal_basis').notNull(),
    verifiedBy: text('verified_by'),
    verifiedAt: tstz('verified_at'),
    createdAt: createdAt(),
  },
  (t) => [
    inList('judicial_recesses', t.branch, DEADLINE_BRANCHES),
    check('judicial_recesses_year_chk', sql`${col('year')} BETWEEN 2000 AND 2100`),
    unique('judicial_recesses_branch_year_uq').on(t.branch, t.year),
  ],
);

export type Court = typeof courts.$inferSelect;
export type Chamber = typeof chambers.$inferSelect;
export type CaseType = typeof caseTypes.$inferSelect;
export type DeadlineRule = typeof deadlineRules.$inferSelect;
export type Holiday = typeof holidays.$inferSelect;
export type JudicialRecess = typeof judicialRecesses.$inferSelect;
