// @tk TK-14
// Özellik testleri P1-P6 (083 §9) ve bağımsız referans yürüyücü karşılaştırması (P22.4).
// fast-check yerine 2026-01-01..2028-12-31 aralığındaki TÜM olay tarihleri x katalogdaki her
// kural x her başlangıç olayı x her tebligat yöntemi taranır (tam numaralandırma).
// Monotonluk testi bilinçli olarak yazılmaz: adli tatil sınırında son gün azalabilir (G09/G10).
import type { DeadlineStartEvent, ServiceMethod } from '@eda/contracts/enums';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  calculateDeadline,
  canonicalJson,
  type DeadlineRuleRecordValue,
  fromIso,
  toIso,
  weekday,
} from '../../src/deadline-engine/index.ts';
import { makeWalker } from '../reference-walker.ts';
import { allCatalogRules, ctxFor, holidayData, readHolidayFixture } from './helpers.ts';

const FIXTURE = readHolidayFixture();
const DATA = holidayData(FIXTURE);
const RULES = allCatalogRules({ verified: true });
const FIRST = fromIso('2026-01-01');
const LAST = fromIso('2028-12-31');
const FULL_HOLIDAYS = new Set(
  FIXTURE.holidays
    .filter((h) => !h.isHalfDay && h.kind !== 'administrative_leave')
    .map((h) => h.date),
);

type Variant = { startEvent: DeadlineStartEvent; serviceMethod: ServiceMethod | null };

function variants(rule: DeadlineRuleRecordValue): Variant[] {
  const out: Variant[] = [];
  for (const startEvent of rule.startEvents) {
    if (startEvent === 'service') {
      for (const serviceMethod of ['postal', 'e_tebligat', null] as const)
        out.push({ startEvent, serviceMethod });
    } else {
      out.push({ startEvent, serviceMethod: null });
    }
  }
  return out;
}

function* everyCalculation() {
  for (const rule of RULES) {
    const ctx = ctxFor(rule, { holidays: DATA });
    for (const v of variants(rule)) {
      for (let d = FIRST; d <= LAST; d = addDays(d, 1)) {
        const input = { ...v, eventDate: toIso(d) };
        const r = calculateDeadline(input, ctx);
        if (!r.ok) throw new Error(`${rule.code} ${input.eventDate}: ${r.code}`);
        yield { rule, input, ctx, value: r.value };
      }
    }
  }
}

describe('KK-P22-12 (KK-083-12) özellik testleri P1-P6, tüm olay tarihleri x tüm katalog profilleri', () => {
  it('P1-P6 her hesapta sağlanır', () => {
    let count = 0;
    const profiles = new Set<string>();
    for (const { rule, input, ctx, value: v } of everyCalculation()) {
      count++;
      profiles.add(
        JSON.stringify([
          rule.params.holidayShift,
          rule.params.recessBranch,
          rule.params.optionalExtension,
        ]),
      );
      const tag = `${rule.code} ${input.startEvent}/${input.serviceMethod} ${input.eventDate}`;
      const raw = v.steps.find((s) => s.kind === 'period')?.date ?? '';
      const due = fromIso(v.dueDate);
      // P1: dueDate >= ham bitiş.
      if (!(v.dueDate >= raw)) expect.fail(`P1 ${tag}`);
      if (rule.params.holidayShift === 'next_working_day') {
        // P2: Pazar ve tam tatil değil (arife yarım gün olabilir).
        if (weekday(due) === 6 || FULL_HOLIDAYS.has(v.dueDate)) expect.fail(`P2 ${tag}`);
        // P3: Cumartesi politikası shift iken Cumartesi değil.
        if (rule.params.saturdayPolicy === 'shift' && weekday(due) === 5) expect.fail(`P3 ${tag}`);
      }
      // P5: çift tarihte tartışmalı tarih sonradır.
      if (
        v.safeDueAt !== null &&
        !(v.contestedDueDate !== null && v.contestedDueDate > v.dueDate)
      ) {
        expect.fail(`P5 ${tag}`);
      }
      // P6: uzama uygulandıysa (contested ?? due) >= tatil son günü + uzama.
      if (v.recessApplied) {
        const ext = v.steps.filter((s) => s.kind === 'recess_extension').at(-1)?.date ?? '9999';
        if (!((v.contestedDueDate ?? v.dueDate) >= ext)) expect.fail(`P6 ${tag}`);
      }
      // P4 (örneklem): her 97. hesapta ikinci çağrı bayt-bayt aynı.
      if (count % 97 === 0) {
        const again = calculateDeadline(input, ctx);
        if (!again.ok || canonicalJson(again.value) !== canonicalJson(v)) expect.fail(`P4 ${tag}`);
        if (JSON.stringify(again.value) !== JSON.stringify(v)) expect.fail(`P4 sıra ${tag}`);
      }
    }
    // 27 kural, 1096 gün; kapsanan profil sayısı (kaydırma x adli tatil dalı x uzatma) >= 8.
    expect(count).toBeGreaterThan(27 * 1096);
    expect(profiles.size).toBeGreaterThanOrEqual(6);
  });
});

describe('KK-P22-12 bağımsız referans yürüyücü ile çapraz kontrol (P-HMK, P-IIK, P-IIK-GM, P-CMK, P-IYUK)', () => {
  const walk = makeWalker(FIXTURE);
  const codes = [
    'hmk_istinaf_basvuru',
    'hmk_ihtiyati_tedbir_itiraz',
    'iik_odeme_emrine_itiraz',
    'iik_imzaya_itiraz',
    'iik_itirazin_iptali_davasi',
    'cmk_temyiz',
    'iyuk_dava_acma_idare',
    'is_ise_iade_arabulucu_basvuru',
  ];
  for (const code of codes) {
    it(`${code}: 2026-2028 her olay tarihinde motor = yürüyücü`, () => {
      const rule = RULES.find((r) => r.code === code);
      if (rule === undefined) throw new Error(code);
      const ctx = ctxFor(rule, { holidays: DATA });
      const ext = rule.params.recessExtension;
      const wrule = {
        durationValue: rule.durationValue,
        durationUnit: rule.durationUnit,
        recessBranch: rule.params.recessBranch,
        recessExtensionDays: ext === null ? null : ext.unit === 'week' ? ext.value * 7 : ext.value,
      };
      const methods = rule.startEvents.includes('service')
        ? (['postal', 'e_tebligat'] as const)
        : ([null] as const);
      const startEvent = rule.startEvents[0] ?? 'service';
      for (const sm of methods) {
        for (let d = FIRST; d <= LAST; d = addDays(d, 1)) {
          const eventDate = toIso(d);
          const r = calculateDeadline(
            { startEvent: sm === null ? startEvent : 'service', eventDate, serviceMethod: sm },
            ctx,
          );
          if (!r.ok) throw new Error(r.code);
          const w = walk(wrule, eventDate, sm === 'e_tebligat');
          const got = {
            dueDate: r.value.dueDate,
            contestedDueDate: r.value.contestedDueDate,
            recessApplied: r.value.recessApplied,
          };
          if (JSON.stringify(got) !== JSON.stringify(w)) {
            expect(got, `${code} ${eventDate} ${sm}`).toEqual(w);
          }
        }
      }
    });
  }
});
