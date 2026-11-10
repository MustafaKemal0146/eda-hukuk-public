// Süre motoru testleri için ortak yardımcılar (veri sentetik; kural verisi 083 §7 kataloğundan).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { HolidayKind } from '@eda/contracts/enums';
import {
  catalogRuleRecord,
  DEADLINE_RULE_CATALOG,
  type DeadlineEngineContext,
  type DeadlineRuleRecordValue,
} from '../../src/deadline-engine/index.ts';
import {
  type HolidayData,
  holidayDataCanonicalJson,
  holidayDataContent,
} from '../../src/holidays/index.ts';

export const TEST_ROOT = join(import.meta.dirname, '..');

export type HolidayFixture = {
  holidays: {
    date: string;
    code: string;
    name: string;
    kind: HolidayKind;
    isHalfDay: boolean;
    startsAtLocal: string | null;
  }[];
  recesses: { branch: string; year: number; start: string; endExclusive: string }[];
};

export function readHolidayFixture(): HolidayFixture {
  return JSON.parse(
    readFileSync(join(TEST_ROOT, 'fixtures', 'holidays-2026-2028.json'), 'utf8'),
  ) as HolidayFixture;
}

/** Fixture -> motor verisi; parmak izi `apps/api` yükleyicisindeki gibi sha256 ilk 16 hex (K3). */
export function holidayData(fixture: HolidayFixture = readHolidayFixture()): HolidayData {
  const content = holidayDataContent(fixture.holidays, fixture.recesses);
  const fingerprint = createHash('sha256')
    .update(holidayDataCanonicalJson(content))
    .digest('hex')
    .slice(0, 16);
  return { ...content, fingerprint };
}

export const OFFICE_CLOSE = CONFIG_DEFAULTS['deadline.officeCloseTime'];

/**
 * Doğrulanmış TEST kopyası: algoritma tutarlılığı vakaları için (083 §9). Gerçek bir doğrulama
 * değildir; değer seed'e ve üretim koduna girmez (Y-83; 032 `DEV-FIXTURE` örüntüsü).
 */
export const TEST_VERIFIER = 'TEST-FIXTURE';
export const TEST_VERIFIED_AT = '2026-01-01T00:00:00+03:00';

export function catalogRule(code: string, opts: { verified: boolean }): DeadlineRuleRecordValue {
  const entry = DEADLINE_RULE_CATALOG.find((e) => e.code === code);
  if (entry === undefined) throw new Error(`katalogda yok: ${code}`);
  const rec = catalogRuleRecord(entry);
  return opts.verified ? { ...rec, verifiedBy: TEST_VERIFIER, verifiedAt: TEST_VERIFIED_AT } : rec;
}

export function allCatalogRules(opts: { verified: boolean }): DeadlineRuleRecordValue[] {
  return DEADLINE_RULE_CATALOG.map((e) => catalogRule(e.code, opts));
}

export function ctxFor(
  rule: DeadlineRuleRecordValue,
  extra: Partial<Omit<DeadlineEngineContext, 'rule'>> = {},
): DeadlineEngineContext {
  return {
    rule,
    holidays: extra.holidays ?? holidayData(),
    court: extra.court ?? null,
    config: extra.config ?? { officeCloseTime: OFFICE_CLOSE },
    mode: extra.mode ?? 'prod',
  };
}

export type GoldenCase = {
  id: string;
  title: string;
  input: {
    startEvent: 'service' | 'pronouncement' | 'learning';
    eventDate: string;
    serviceMethod: 'postal' | 'e_tebligat' | null;
    courtExempt: boolean;
  };
  expected: {
    dueDate: string;
    dueAt: string;
    safeDueAt: string | null;
    contestedDueDate: string | null;
    recessApplied: boolean;
    appliedHolidays: { date: string; code: string }[];
    stepKinds: string[];
    warnings: string[];
  };
  rationale: string;
  reviewedBy: string | null;
};

export type GoldenFile = { ruleCode: string; ruleVersion: number; cases: GoldenCase[] };

export function readGoldenFiles(): GoldenFile[] {
  const dir = join(TEST_ROOT, 'golden');
  const files = readdirSync(dir)
    .filter((f) => /^[a-z0-9_]+\.v\d+\.json$/.test(f))
    .sort();
  return files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as GoldenFile);
}

export function allGoldenCases(): (GoldenCase & { ruleCode: string })[] {
  return readGoldenFiles()
    .flatMap((f) => f.cases.map((c) => ({ ...c, ruleCode: f.ruleCode })))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}
