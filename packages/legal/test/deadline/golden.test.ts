// @tk TK-14
// Süre motoru altın vakaları (083 §9 G01-G37). Beklenen son gün tablodan aynen; adım türleri ve
// uyarılar §5.2 algoritma izinden elle çıkarılmıştır. `reviewedBy: null` = hukuk onayı bekliyor
// vaka algoritma tutarlılığı için geçmek zorundadır.
import { describe, expect, it } from 'vitest';
import {
  calculateDeadline,
  DEADLINE_RULE_CATALOG,
  type DeadlineCalcResult,
  ENGINE_VERSION,
} from '../../src/deadline-engine/index.ts';
import { allGoldenCases, catalogRule, ctxFor, type GoldenCase, holidayData } from './helpers.ts';

const DATA = holidayData();

function run(ruleCode: string, c: GoldenCase): DeadlineCalcResult {
  const rule = catalogRule(ruleCode, { verified: true });
  return calculateDeadline(
    {
      startEvent: c.input.startEvent,
      eventDate: c.input.eventDate,
      serviceMethod: c.input.serviceMethod,
    },
    ctxFor(rule, {
      holidays: DATA,
      court: c.input.courtExempt ? { adminRecessExempt: true } : null,
    }),
  );
}

function ok(r: DeadlineCalcResult) {
  if (!r.ok) throw new Error(`beklenmeyen hata: ${r.code}`);
  return r.value;
}

const CASES = allGoldenCases();
const byId = (id: string) => {
  const c = CASES.find((x) => x.id === id);
  if (c === undefined) throw new Error(id);
  return ok(run(c.ruleCode, c));
};

describe('KK-P22-2 (KK-083-2) altın vakalar G01-G37 birebir', () => {
  it('37 vaka, kimlikler G01..G37, hepsi reviewedBy:null ve kural katalogda', () => {
    expect(CASES.map((c) => c.id)).toEqual(
      Array.from({ length: 37 }, (_, i) => `G${String(i + 1).padStart(2, '0')}`),
    );
    for (const c of CASES) {
      expect(c.reviewedBy).toBeNull();
      expect(c.rationale.length).toBeGreaterThan(0);
      expect(DEADLINE_RULE_CATALOG.some((e) => e.code === c.ruleCode)).toBe(true);
    }
  });

  for (const c of CASES) {
    it(`${c.id} ${c.ruleCode}: ${c.title}`, () => {
      const v = ok(run(c.ruleCode, c));
      expect({
        dueDate: v.dueDate,
        dueAt: v.dueAt,
        safeDueAt: v.safeDueAt,
        contestedDueDate: v.contestedDueDate,
        recessApplied: v.recessApplied,
        appliedHolidays: v.appliedHolidays.map((h) => ({ date: h.date, code: h.code })),
        stepKinds: v.steps.map((s) => s.kind),
        warnings: v.warnings.map((w) => w.code),
      }).toEqual(c.expected);
    });
  }
});

describe('KK-P22-6 (KK-083-6) arife ve zincir çift tarihi', () => {
  const dual = ['G03', 'G08', 'G25', 'G26', 'G27', 'G28'];
  it('çift tarihli vakalarda safeDueAt = dueAt ve contestedDueDate > dueDate', () => {
    for (const id of dual) {
      const v = byId(id);
      expect(v.safeDueAt, id).toBe(v.dueAt);
      expect(v.contestedDueDate !== null && v.contestedDueDate > v.dueDate, id).toBe(true);
      expect(
        v.warnings.map((w) => w.code),
        id,
      ).toContain('contested_extension');
    }
  });
  it('diğer hiçbir vakada safeDueAt/contestedDueDate dolu değildir', () => {
    for (const c of CASES.filter((x) => !dual.includes(x.id))) {
      const v = ok(run(c.ruleCode, c));
      expect(v.safeDueAt, c.id).toBeNull();
      expect(v.contestedDueDate, c.id).toBeNull();
    }
  });
  it('arife: güvenli an 13:00, tartışmalı tarih notta; tatiller appliedHolidays dışında (083 §6.2)', () => {
    const v = byId('G03');
    expect(v.dueAt).toBe('2026-03-19T13:00:00+03:00');
    expect(v.appliedHolidays).toEqual([]);
    expect(v.steps.at(-1)?.note).toContain('23.03.2026');
  });
});

describe('KK-P22-7 (KK-083-7) adli tatil sınırları ve muafiyetler', () => {
  it('19.07 uzamaz; 20.07 ve 31.08 uzar; 01.09 uzamaz', () => {
    expect(byId('G07').recessApplied).toBe(true);
    expect(byId('G09').recessApplied).toBe(true);
    expect(byId('G10').recessApplied).toBe(false);
    const rule = catalogRule('hmk_istinaf_basvuru', { verified: true });
    // Sentetik sınır vakası (algoritma tutarlılığı): 05.07.2027 + 2 hafta = 19.07.2027 Pazartesi,
    // adli tatilden (20.07.2027) önceki gün -> uzama yok.
    const v = ok(
      calculateDeadline(
        { startEvent: 'service', eventDate: '2027-07-05', serviceMethod: 'postal' },
        ctxFor(rule, { holidays: DATA }),
      ),
    );
    expect(v.dueDate).toBe('2027-07-19');
    expect(v.recessApplied).toBe(false);
    expect(v.steps.map((s) => s.kind)).toEqual(['start', 'period']);
  });
  it('recess_applies = false kurallar (G15, G30) ve muaf mahkeme (G21) uzamaz', () => {
    expect(byId('G15').recessApplied).toBe(false);
    expect(byId('G30').recessApplied).toBe(false);
    const g21 = byId('G21');
    expect(g21.recessApplied).toBe(false);
    expect(g21.steps.find((s) => s.kind === 'period')?.note).toContain('İYUK m.61');
  });
  it('muafiyet bayrağı yalnız İYUK kurallarında okunur', () => {
    const rule = catalogRule('hmk_istinaf_basvuru', { verified: true });
    const v = ok(
      calculateDeadline(
        { startEvent: 'service', eventDate: '2026-07-16', serviceMethod: 'postal' },
        ctxFor(rule, { holidays: DATA, court: { adminRecessExempt: true } }),
      ),
    );
    expect(v.dueDate).toBe('2026-09-07');
    expect(v.recessApplied).toBe(true);
  });
});

describe('KK-P22-8 (KK-083-8) e-tebligat', () => {
  it('olay + 5 gün tebliğ sayılır, kaydırma yok, e_tebligat adımı (G02, G31)', () => {
    const g02 = byId('G02');
    expect(g02.effectiveServiceDate).toBe('2026-03-07');
    expect(g02.steps[0]).toMatchObject({ kind: 'e_tebligat', legalBasis: 'Tebligat K. m.7/a' });
    const g31 = byId('G31');
    // 03.01.2027 Pazar: tebliğ sayılan gün kaydırılmaz (T-8).
    expect(g31.effectiveServiceDate).toBe('2027-01-03');
  });
  it('postal varsayılanı yalnız service olayında ve çıktıda belirtilir', () => {
    const v = byId('G17');
    expect(v.serviceMethod).toBe('postal');
    expect(v.steps[0]?.note).toContain('varsayıldı');
    expect(byId('G16').serviceMethod).toBeNull();
  });
});

describe('KK-P22-9 (KK-083-9) ay aritmetiği', () => {
  it('30.01 + 1 ay = 28.02, 31.03 + 1 ay = 30.04, 31.01.2028 + 1 ay = 29.02.2028', () => {
    expect(byId('G11').steps.find((s) => s.kind === 'period')?.date).toBe('2026-02-28');
    expect(byId('G12').dueDate).toBe('2026-04-30');
    expect(byId('G29').dueDate).toBe('2028-02-29');
  });
});

describe('KK-P22-10 (KK-083-10) Cumartesi politikası', () => {
  it('shift: Cumartesi -> Pazartesi ve saturday_shift (G04); workday: Cumartesi kalır', () => {
    expect(byId('G04').dueDate).toBe('2026-03-16');
    const base = catalogRule('hmk_cevap_dilekcesi', { verified: true });
    const workday = { ...base, params: { ...base.params, saturdayPolicy: 'workday' as const } };
    const v = ok(
      calculateDeadline(
        { startEvent: 'service', eventDate: '2026-02-28', serviceMethod: 'postal' },
        ctxFor(workday, { holidays: DATA }),
      ),
    );
    expect(v.dueDate).toBe('2026-03-14');
    expect(v.warnings).toEqual([]);
    expect(v.meta.saturdayPolicy).toBe('workday');
  });
});

describe('KK-P22-11 (KK-083-11) süreç süresi', () => {
  it('holidayShift = none kaydırmaz ve 23:59 ile biter (G22-G24)', () => {
    for (const id of ['G22', 'G23', 'G24']) {
      const v = byId(id);
      expect(v.dueAt.slice(11, 16), id).toBe('23:59');
      expect(
        v.steps.some((s) => s.kind.endsWith('_shift')),
        id,
      ).toBe(false);
      expect(v.periodNature).toBe('process');
    }
    expect(byId('G22').steps.at(-1)).toMatchObject({
      kind: 'mediation_extension',
      date: '2026-03-02',
    });
    expect(byId('G23').steps.at(-1)).toMatchObject({
      kind: 'mediation_extension',
      date: '2026-04-30',
    });
  });
});

describe('KK-P22-5 (KK-083-5) tatil verisi eksikliği', () => {
  it('G37: veri olmayan yılda hesap yapılır ve holiday_data_missing döner', () => {
    const v = byId('G37');
    expect(v.dueDate).toBe('2029-02-19');
    expect(v.warnings[0]?.message).toContain('2029');
  });
  it('veri olan yılda uyarı yoktur', () => {
    expect(byId('G01').warnings).toEqual([]);
  });
  it('eksik adli tatil satırı: uzama uygulanmaz ve uyarı verilir', () => {
    const data = holidayData();
    const partial = {
      ...data,
      recesses: data.recesses.filter((r) => !(r.branch === 'hmk' && r.year === 2026)),
    };
    const rule = catalogRule('hmk_istinaf_basvuru', { verified: true });
    const v = ok(
      calculateDeadline(
        { startEvent: 'service', eventDate: '2026-07-16', serviceMethod: 'postal' },
        ctxFor(rule, { holidays: partial }),
      ),
    );
    expect(v.dueDate).toBe('2026-07-30');
    expect(v.recessApplied).toBe(false);
    expect(v.warnings.map((w) => w.code)).toEqual(['holiday_data_missing']);
  });
  it('idari izin günü iş günüdür; yalnız uyarı üretir (T-10)', () => {
    const data = holidayData();
    const withLeave = {
      ...data,
      holidays: [
        ...data.holidays,
        {
          date: '2026-03-12',
          code: 'ornek_idari_izin',
          name: 'Örnek idari izin',
          kind: 'administrative_leave' as const,
          isHalfDay: false,
          startsAtLocal: null,
        },
      ],
    };
    const rule = catalogRule('hmk_cevap_dilekcesi', { verified: true });
    const v = ok(
      calculateDeadline(
        { startEvent: 'service', eventDate: '2026-02-26', serviceMethod: 'postal' },
        ctxFor(rule, { holidays: withLeave }),
      ),
    );
    expect(v.dueDate).toBe('2026-03-12');
    expect(v.warnings.map((w) => w.code)).toEqual(['administrative_leave']);
  });
});

describe('KK-P22-4 (KK-083-4) doğrulanmamış kural (motor kipi)', () => {
  const input = {
    startEvent: 'service' as const,
    eventDate: '2026-03-05',
    serviceMethod: 'postal' as const,
  };
  it('prod kipinde doğrulanmamış kural seçilemez', () => {
    const rule = catalogRule('hmk_istinaf_basvuru', { verified: false });
    expect(calculateDeadline(input, ctxFor(rule, { holidays: DATA }))).toEqual({
      ok: false,
      code: 'DEADLINE_RULE_UNVERIFIED',
    });
  });
  it('önizleme kipinde hesaplanır ve rule_unverified_preview taşır', () => {
    const rule = catalogRule('hmk_istinaf_basvuru', { verified: false });
    const v = ok(calculateDeadline(input, ctxFor(rule, { holidays: DATA, mode: 'preview' })));
    expect(v.warnings.map((w) => w.code)).toContain('rule_unverified_preview');
    expect(v.verifiedBy).toBeNull();
  });
  it('yerini almış (superseded) kural iki kipte de seçilemez', () => {
    const rule = {
      ...catalogRule('hmk_istinaf_basvuru', { verified: true }),
      supersededAt: '2026-06-01T00:00:00+03:00',
    };
    for (const mode of ['prod', 'preview'] as const) {
      expect(calculateDeadline(input, ctxFor(rule, { holidays: DATA, mode })).ok).toBe(false);
    }
  });
});

describe('KK-P22-15 (KK-083-16) çıktı bütünlüğü', () => {
  it('her vakada kural kimliği, dayanak, doğrulayan, start+period, motor sürümü ve meta', () => {
    for (const c of CASES) {
      const v = ok(run(c.ruleCode, c));
      expect(v.ruleCode).toBe(c.ruleCode);
      expect(v.ruleVersion).toBe(1);
      expect(v.lawRef.length).toBeGreaterThan(0);
      expect(v.verifiedBy).toBe('TEST-FIXTURE');
      expect(v.verifiedAt).not.toBeNull();
      const kinds = v.steps.map((s) => s.kind);
      expect(kinds).toContain('start');
      expect(kinds).toContain('period');
      expect(v.engineVersion).toBe(ENGINE_VERSION);
      expect(v.meta.holidayDataFingerprint).toMatch(/^[0-9a-f]{16}$/);
      expect(v.meta.coverageYears).toEqual([2026, 2027, 2028]);
      expect(v.meta.officeCloseTime).toBe('17:00');
      expect(v.meta.rulePublishedParams).toEqual(
        catalogRule(c.ruleCode, { verified: true }).params,
      );
      expect(v.steps.every((s) => s.note.length > 0)).toBe(true);
    }
  });
});
