// @tk TK-14
// Negatif vakalar (083 §9 N1-N6). Hata kodları 044 kataloğundadır; HTTP zarfı KB'de (API) sınanır.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEADLINE_CALC_REASONS } from '@eda/contracts/api/deadlines';
import { ERROR_CATALOG } from '@eda/contracts/errors';
import { describe, expect, it } from 'vitest';
import {
  calculateDeadline,
  DeadlineEngineError,
  parseDeadlineRule,
} from '../../src/deadline-engine/index.ts';
import { catalogRule, ctxFor, holidayData, TEST_ROOT } from './helpers.ts';

type NegativeCase = {
  id: string;
  title: string;
  ruleCode: string;
  mode: 'prod' | 'preview';
  verified: boolean;
  corrupt?: Record<string, null>;
  input: {
    startEvent: 'service' | 'pronouncement' | 'learning';
    eventDate: string;
    serviceMethod: 'postal' | 'e_tebligat' | null;
  };
  expected: { code: string; reason: string | null };
};

const NEG = JSON.parse(readFileSync(join(TEST_ROOT, 'golden', 'negative.json'), 'utf8')) as {
  cases: NegativeCase[];
};
const DATA = holidayData();

describe('KK-P22-3 (KK-083-3) negatif vakalar N1-N6', () => {
  it('altı vaka; hata kodları 044 kataloğunda ve 422', () => {
    expect(NEG.cases.map((c) => c.id)).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N6']);
    expect(ERROR_CATALOG.DEADLINE_RULE_UNVERIFIED.http).toBe(422);
    expect(ERROR_CATALOG.VALIDATION_FAILED.http).toBe(422);
    const reasons: readonly string[] = ERROR_CATALOG.VALIDATION_FAILED.reasons;
    for (const r of DEADLINE_CALC_REASONS) expect(reasons).toContain(r);
  });

  for (const c of NEG.cases.filter((x) => x.corrupt === undefined)) {
    it(`${c.id}: ${c.title}`, () => {
      const rule = catalogRule(c.ruleCode, { verified: c.verified });
      const r = calculateDeadline(c.input, ctxFor(rule, { holidays: DATA, mode: c.mode }));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe(c.expected.code);
      expect('reason' in r ? r.reason : null).toBe(c.expected.reason);
    });
  }

  it('N6: bozuk kural satırı (recess_applies = true, recessBranch = null) yüklenmez', () => {
    const rule = catalogRule('hmk_istinaf_basvuru', { verified: true });
    const corrupt = { ...rule, params: { ...rule.params, recessBranch: null } };
    expect(() => parseDeadlineRule(corrupt)).toThrow(DeadlineEngineError);
    try {
      parseDeadlineRule(corrupt);
    } catch (e) {
      expect((e as DeadlineEngineError).code).toBe('rule_invalid');
    }
    expect(parseDeadlineRule(rule)).toEqual(rule);
  });

  it('N4 sınırları: 2000-01-01 ve 2100-12-31 kabul aralığındadır', () => {
    const rule = {
      ...catalogRule('hmk_istinaf_basvuru', { verified: true }),
      effectiveDuring: { start: '2000-01-01', endExclusive: null },
    };
    const at = (eventDate: string) =>
      calculateDeadline(
        { startEvent: 'service', eventDate, serviceMethod: 'postal' },
        ctxFor(rule, { holidays: DATA }),
      ).ok;
    expect(at('2000-01-01')).toBe(true);
    expect(at('2100-12-31')).toBe(true);
    expect(at('2101-01-01')).toBe(false);
    expect(at('2026-02-30')).toBe(false);
  });

  it('N5: yürürlük aralığı yarı açıktır ([başlangıç, bitiş))', () => {
    const rule = {
      ...catalogRule('hmk_istinaf_basvuru', { verified: true }),
      effectiveDuring: { start: '2024-01-01', endExclusive: '2026-01-01' },
    };
    const at = (eventDate: string) =>
      calculateDeadline(
        { startEvent: 'service', eventDate, serviceMethod: 'postal' },
        ctxFor(rule, { holidays: DATA }),
      );
    expect(at('2025-12-31').ok).toBe(true);
    expect(at('2026-01-01')).toEqual({
      ok: false,
      code: 'VALIDATION_FAILED',
      reason: 'rule_not_effective',
    });
  });
});
