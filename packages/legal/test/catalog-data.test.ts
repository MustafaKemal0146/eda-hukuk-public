// @tk TK-29
// KK-P03c-7 (KK-032-10 uyarlanmış): seed veri modüllerinin sayıları, tekil anahtarları, Zod şemaları ve
// DB CHECK kümeleri (030 §5; packages/db/migrations/0004_schema_app_core.sql).
import {
  DEADLINE_BRANCHES,
  DEADLINE_PERIOD_UNITS,
  DEADLINE_START_EVENTS,
  HOLIDAY_KINDS,
  SENSITIVE_TOPIC_CODES,
} from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import {
  CASE_TYPE_CATALOG,
  CASE_TYPE_CODE_PATTERN,
  CaseTypeRowSchema,
} from '../src/courts/index.ts';
import {
  CATALOG_NOTE_PREFIX,
  catalogNotes,
  catalogRuleRecord,
  DEADLINE_RULE_CATALOG,
  toDateRangeLiteral,
} from '../src/deadline-engine/index.ts';

/** `deadline_rules_code_chk` (0004). Kural satırları 083 §7 kataloğundan (P22). */
const DEADLINE_RULE_CODE_PATTERN = /^[a-z0-9_]{3,64}$/;
const RULES = DEADLINE_RULE_CATALOG.map((e) => catalogRuleRecord(e));

import {
  HOLIDAY_CODE_PATTERN,
  HOLIDAYS,
  HolidayRowSchema,
  JUDICIAL_RECESSES,
  JudicialRecessRowSchema,
} from '../src/holidays/index.ts';

function expectUnique(keys: string[]): void {
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  expect(dupes).toEqual([]);
}

function includes(list: readonly string[], value: string | null): boolean {
  return value === null || list.includes(value);
}

describe('KK-P03c-7: satır sayıları', () => {
  it('39 dava türü, 51 tatil, 9 adli tatil, 27 süre kuralı taslağı', () => {
    expect(CASE_TYPE_CATALOG).toHaveLength(39);
    expect(HOLIDAYS).toHaveLength(51);
    expect(JUDICIAL_RECESSES).toHaveLength(9);
    expect(DEADLINE_RULE_CATALOG).toHaveLength(27);
  });
});

describe('KK-P03c-7: tekil anahtarlar', () => {
  it('case_types.code', () => expectUnique(CASE_TYPE_CATALOG.map((r) => r.code)));
  it('holidays (holiday_date, code)', () =>
    expectUnique(HOLIDAYS.map((r) => `${r.holidayDate}|${r.code}`)));
  it('judicial_recesses (branch, year)', () =>
    expectUnique(JUDICIAL_RECESSES.map((r) => `${r.branch}|${r.year}`)));
  it('deadline_rules (code, version)', () =>
    expectUnique(RULES.map((r) => `${r.code}|${r.version}`)));
});

describe('KK-P03c-7: her satır Zod şemasından geçer', () => {
  it('case_types', () => {
    for (const r of CASE_TYPE_CATALOG) expect(CaseTypeRowSchema.safeParse(r).error).toBeUndefined();
  });
  it('holidays', () => {
    for (const r of HOLIDAYS) expect(HolidayRowSchema.safeParse(r).error).toBeUndefined();
  });
  it('judicial_recesses', () => {
    for (const r of JUDICIAL_RECESSES)
      expect(JudicialRecessRowSchema.safeParse(r).error).toBeUndefined();
  });
  it('şema yarım gün CHECK ihlalini reddeder', () => {
    const [first] = HOLIDAYS;
    expect(
      HolidayRowSchema.safeParse({ ...first, isHalfDay: true, startsAtLocal: null }).success,
    ).toBe(false);
  });
});

describe('KK-P03c-7: değerler DB CHECK kümelerine uyar', () => {
  it('kod desenleri migrasyondaki CHECK desenleriyle aynıdır', () => {
    expect(CASE_TYPE_CODE_PATTERN.source).toBe('^[a-z0-9._-]{2,64}$');
    expect(HOLIDAY_CODE_PATTERN.source).toBe('^[a-z0-9_]{3,64}$');
    expect(DEADLINE_RULE_CODE_PATTERN.source).toBe('^[a-z0-9_]{3,64}$');
  });

  it('case_types: branch, sensitive_topic', () => {
    for (const r of CASE_TYPE_CATALOG) {
      expect(CASE_TYPE_CODE_PATTERN.test(r.code)).toBe(true);
      expect(includes(DEADLINE_BRANCHES, r.branch)).toBe(true);
      expect(includes(SENSITIVE_TOPIC_CODES, r.sensitiveTopic)).toBe(true);
    }
    expect(CASE_TYPE_CATALOG.filter((r) => r.branch === null).map((r) => r.code)).toEqual([
      'other',
    ]);
  });

  it('holidays: kind, code', () => {
    for (const r of HOLIDAYS) {
      expect(HOLIDAY_CODE_PATTERN.test(r.code)).toBe(true);
      expect(HOLIDAY_KINDS.includes(r.kind)).toBe(true);
    }
  });

  it('judicial_recesses: branch, year', () => {
    for (const r of JUDICIAL_RECESSES) {
      expect(DEADLINE_BRANCHES.includes(r.branch)).toBe(true);
      expect(r.year >= 2000 && r.year <= 2100).toBe(true);
    }
  });

  it('deadline_rules: branch, birim, başlangıç olayları, süre, sürüm', () => {
    for (const r of RULES) {
      expect(DEADLINE_RULE_CODE_PATTERN.test(r.code)).toBe(true);
      expect(r.version).toBe(1);
      expect(DEADLINE_BRANCHES.includes(r.branch)).toBe(true);
      expect(DEADLINE_PERIOD_UNITS.includes(r.durationUnit)).toBe(true);
      expect(r.durationValue).toBeGreaterThan(0);
      expect(r.startEvents.length).toBeGreaterThan(0);
      for (const e of r.startEvents) expect(DEADLINE_START_EVENTS.includes(e)).toBe(true);
      expect(new Set(r.startEvents).size).toBe(r.startEvents.length);
    }
  });
});

describe('KK-P03c-7: süre kuralı taslakları (083 §7 kataloğu; seed kaynağı)', () => {
  it('hepsi doğrulanmamış; not taslak önekini ve güveni taşır; geçerlilik [2024-01-01,)', () => {
    for (const e of DEADLINE_RULE_CATALOG) {
      const r = catalogRuleRecord(e);
      expect([r.verifiedBy, r.verifiedAt]).toEqual([null, null]);
      expect(catalogNotes(e).startsWith(`${CATALOG_NOTE_PREFIX}; güven ${e.confidence}`)).toBe(
        true,
      );
      expect(toDateRangeLiteral(r.effectiveDuring)).toBe('[2024-01-01,)');
    }
  });

  it('dal başına kural sayısı (hmk 9, iik 6, iyuk 5, cmk 4, mediation 3)', () => {
    const count = (b: string) => RULES.filter((r) => r.branch === b).length;
    expect([count('hmk'), count('iik'), count('iyuk'), count('cmk'), count('mediation')]).toEqual([
      9, 6, 5, 4, 3,
    ]);
  });
});

describe('KK-P03c-7: sabitler dondurulmuştur', () => {
  it('diziler ve satırlar değiştirilemez', () => {
    for (const list of [CASE_TYPE_CATALOG, HOLIDAYS, JUDICIAL_RECESSES]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect(Object.isFrozen(list[0])).toBe(true);
    }
    expect(Object.isFrozen(JUDICIAL_RECESSES[0]?.period)).toBe(true);
  });
});
