// Hukuk referans kataloğu seed'leri (032 §10.3–§10.5): dava türleri (39), resmî tatiller (51), adli
// tatiller (9), süre kuralı TASLAKLARI (27; `verified_*` NULL; 083 §7 kataloğu, P22). Veri tek kaynaktan,
// `@eda/legal` saf modüllerinden gelir; burada yalnız kolon eşlemesi + upsert vardır. Hepsi hukuk onayı bekliyor.
// `courts`/`chambers` (P20), platform şablonları (P18) ve `prompt_versions` (P07) sonraki promptlardadır.
import { CASE_TYPE_CATALOG, type CaseTypeRow } from '@eda/legal/courts';
import {
  catalogNotes,
  catalogRuleRecord,
  DEADLINE_RULE_CATALOG,
  type DeadlineRuleCatalogEntry,
} from '@eda/legal/deadline-engine';
import {
  HOLIDAYS,
  type HolidayRow,
  JUDICIAL_RECESSES,
  type JudicialRecessRow,
  toDateRangeLiteral,
} from '@eda/legal/holidays';
import type { SeedDef } from '../types.ts';
import {
  assertVerifiedUnchanged,
  deactivateMissing,
  type UpsertSpec,
  upsertRows,
} from '../upsert.ts';

const CASE_TYPES: UpsertSpec = {
  table: 'app.case_types',
  key: ['code'],
  columns: ['code', 'name', 'branch', 'legal_basis', 'sensitive_topic'],
  update: ['name', 'branch', 'legal_basis', 'sensitive_topic'],
};

export function caseTypesSeed(rows: readonly CaseTypeRow[] = CASE_TYPE_CATALOG): SeedDef {
  const mapped = rows.map((r) => ({
    code: r.code,
    name: r.name,
    branch: r.branch,
    legal_basis: r.legalBasis,
    sensitive_topic: r.sensitiveTopic,
  }));
  return {
    name: 'case_types',
    stage: 'prod',
    content: mapped,
    async apply(q) {
      const counts = await upsertRows(q, CASE_TYPES, mapped);
      counts.updated += await deactivateMissing(
        q,
        'app.case_types',
        'code',
        mapped.map((r) => r.code),
      );
      return counts;
    },
  };
}

const HOLIDAY_SPEC: UpsertSpec = {
  table: 'app.holidays',
  key: ['holiday_date', 'code'],
  columns: [
    'holiday_date',
    'code',
    'name',
    'kind',
    'is_half_day',
    'starts_at_local',
    'legal_basis',
    'source',
  ],
  update: ['name', 'kind', 'is_half_day', 'starts_at_local', 'legal_basis', 'source'],
  casts: { holiday_date: 'date', starts_at_local: 'time' },
};

export function holidaysSeed(rows: readonly HolidayRow[] = HOLIDAYS): SeedDef {
  const mapped = rows.map((r) => ({
    holiday_date: r.holidayDate,
    code: r.code,
    name: r.name,
    kind: r.kind,
    is_half_day: r.isHalfDay,
    starts_at_local: r.startsAtLocal,
    legal_basis: r.legalBasis,
    source: r.source,
  }));
  return {
    name: 'holidays',
    stage: 'prod',
    content: mapped,
    apply: (q) => upsertRows(q, HOLIDAY_SPEC, mapped),
  };
}

const RECESS_SPEC: UpsertSpec = {
  table: 'app.judicial_recesses',
  key: ['branch', 'year'],
  columns: ['branch', 'year', 'period', 'legal_basis'],
  update: ['period', 'legal_basis'],
  casts: { period: 'daterange' },
};

export function judicialRecessesSeed(
  rows: readonly JudicialRecessRow[] = JUDICIAL_RECESSES,
): SeedDef {
  const mapped = rows.map((r) => ({
    branch: r.branch,
    year: r.year,
    period: toDateRangeLiteral(r.period),
    legal_basis: r.legalBasis,
  }));
  return {
    name: 'judicial_recesses',
    stage: 'prod',
    content: mapped,
    apply: (q) => upsertRows(q, RECESS_SPEC, mapped),
  };
}

const RULE_COLUMNS = [
  'branch',
  'title',
  'law_ref',
  'law_no',
  'article_no',
  'duration_value',
  'duration_unit',
  'start_events',
  'recess_applies',
  'params',
  'effective_during',
  'notes',
] as const;

export const DEADLINE_RULE_SPEC: UpsertSpec = {
  table: 'app.deadline_rules',
  key: ['code', 'version'],
  columns: ['code', 'version', ...RULE_COLUMNS],
  update: [...RULE_COLUMNS],
  casts: { start_events: 'text[]', params: 'jsonb', effective_during: 'daterange' },
  // Yalnız doğrulanmamış taslak güncellenir (032 §10.1).
  updateWhere: 'deadline_rules.verified_at IS NULL',
};

/** 083 §7 katalog girdisi -> `app.deadline_rules` kolonları (P22 kataloğu tek kaynak). */
export function mapRuleEntry(e: DeadlineRuleCatalogEntry): Record<string, unknown> {
  const r = catalogRuleRecord(e);
  return {
    code: r.code,
    version: r.version,
    branch: r.branch,
    title: r.title,
    law_ref: r.lawRef,
    law_no: null,
    article_no: null,
    duration_value: r.durationValue,
    duration_unit: r.durationUnit,
    start_events: [...r.startEvents],
    recess_applies: r.recessApplies,
    params: JSON.stringify(r.params),
    effective_during: toDateRangeLiteral(r.effectiveDuring),
    notes: catalogNotes(e),
  };
}

export function deadlineRulesSeed(
  rows: readonly DeadlineRuleCatalogEntry[] = DEADLINE_RULE_CATALOG,
): SeedDef {
  const mapped = rows.map(mapRuleEntry);
  return {
    name: 'deadline_rules',
    stage: 'prod',
    content: mapped,
    async apply(q) {
      // Doğrulanmış satırın taslağı değiştiyse hiçbir şey yazılmadan çıkış 41.
      await assertVerifiedUnchanged(q, DEADLINE_RULE_SPEC, mapped);
      return upsertRows(q, DEADLINE_RULE_SPEC, mapped);
    },
  };
}
