// Süre ve takvim sözleşmeleri (P22.2; 083 §2.2, §3.1; 041 §6.5). Veri sentetiktir.
import { describe, expect, it } from 'vitest';
import { EventInput, ReminderInput } from '../src/api/calendar.ts';
import {
  DeadlineCalcInput,
  DeadlineInput,
  DeadlinePatchInput,
  DeadlineRuleParams,
  DeadlineRuleRecord,
} from '../src/api/deadlines.ts';

const params = {
  startNextDay: true,
  holidayShift: 'next_working_day',
  saturdayPolicy: 'shift',
  endTime: 'office_close',
  recessBranch: 'hmk',
  recessExtension: { value: 7, unit: 'day' },
  optionalExtension: null,
  periodNature: 'procedural',
  startEventLabels: {},
  aliases: ['örnek süre'],
} as const;

const record = {
  code: 'ornek_kural',
  version: 1,
  branch: 'hmk',
  title: 'Örnek kural',
  lawRef: 'Örnek dayanak',
  durationValue: 2,
  durationUnit: 'week',
  startEvents: ['service'],
  recessApplies: true,
  params,
  effectiveDuring: { start: '2024-01-01', endExclusive: null },
  verifiedBy: null,
  verifiedAt: null,
  supersededAt: null,
} as const;

describe('KK-P22-1 (KK-083-1) DeadlineRuleParams zorunlu anahtarlar', () => {
  it('tam anahtar kümesi geçer', () => {
    expect(DeadlineRuleParams.safeParse(params).success).toBe(true);
  });

  it.each(Object.keys(params))('%s anahtarı eksikse reddedilir', (key) => {
    const copy: Record<string, unknown> = { ...params };
    delete copy[key];
    expect(DeadlineRuleParams.safeParse(copy).success).toBe(false);
  });

  it('startNextDay false olamaz; bilinmeyen anahtar reddedilir', () => {
    expect(DeadlineRuleParams.safeParse({ ...params, startNextDay: false }).success).toBe(false);
    expect(DeadlineRuleParams.safeParse({ ...params, extension: null }).success).toBe(false);
  });

  it('N6: recessApplies=true iken recessBranch=null satır hatası verir', () => {
    const bad = { ...record, params: { ...params, recessBranch: null } };
    expect(DeadlineRuleRecord.safeParse(bad).success).toBe(false);
    const bad2 = { ...record, recessApplies: false };
    expect(DeadlineRuleRecord.safeParse(bad2).success).toBe(false);
    expect(DeadlineRuleRecord.safeParse(record).success).toBe(true);
  });

  it('doğrulayan ve tarih birlikte dolu ya da boş olmalı', () => {
    expect(DeadlineRuleRecord.safeParse({ ...record, verifiedBy: 'Av. Örnek' }).success).toBe(
      false,
    );
  });
});

describe('P22.2 DeadlineCalcInput ve DeadlineInput (083 §3.1, KK-083-17)', () => {
  const input = {
    ruleCode: 'ornek_kural',
    startEvent: 'service',
    eventDate: '2026-03-05',
    serviceMethod: 'postal',
    caseId: null,
    courtCode: null,
  };

  it('strict: bilinmeyen alan reddedilir', () => {
    expect(DeadlineCalcInput.safeParse(input).success).toBe(true);
    expect(DeadlineCalcInput.safeParse({ ...input, extra: 1 }).success).toBe(false);
    expect(DeadlineCalcInput.safeParse({ ...input, ruleCode: 'A-B' }).success).toBe(false);
  });

  it('KK-P22-16: istemci dueDate gönderemez (şemada yok)', () => {
    const body = { ...input, acknowledgements: [] };
    expect(DeadlineInput.safeParse(body).success).toBe(true);
    expect(DeadlineInput.safeParse({ ...body, dueDate: '2026-03-19' }).success).toBe(false);
  });

  it('PATCH: durum ile hesap girdileri birlikte gönderilmez', () => {
    expect(DeadlinePatchInput.safeParse({ status: 'filed_declared' }).success).toBe(true);
    expect(DeadlinePatchInput.safeParse({ eventDate: '2026-03-06' }).success).toBe(true);
    expect(
      DeadlinePatchInput.safeParse({ status: 'cancelled', eventDate: '2026-03-06' }).success,
    ).toBe(false);
  });
});

describe('P22.2 takvim sözleşmeleri (041 §6.5)', () => {
  const ev = {
    type: 'hearing',
    title: 'Örnek duruşma',
    startsAt: '2026-03-10T10:00:00+03:00',
    allDay: false,
  };

  it('deadline türü elle oluşturulamaz', () => {
    expect(EventInput.safeParse(ev).success).toBe(true);
    expect(EventInput.safeParse({ ...ev, type: 'deadline' }).success).toBe(false);
  });

  it('başlık 1-200, esas no <= 32, not <= 2000', () => {
    expect(EventInput.safeParse({ ...ev, title: '' }).success).toBe(false);
    expect(EventInput.safeParse({ ...ev, esasNo: 'x'.repeat(33) }).success).toBe(false);
    expect(EventInput.safeParse({ ...ev, notes: 'x'.repeat(2001) }).success).toBe(false);
  });

  it('hatırlatıcı hedefi tektir; ofset 5 dk - 30 gün', () => {
    const id = '0190a0b0-0000-7000-8000-000000000001';
    expect(
      ReminderInput.safeParse({ offsetMinutes: 15, channel: 'in_app', deadlineId: id }).success,
    ).toBe(true);
    expect(
      ReminderInput.safeParse({ offsetMinutes: 4, channel: 'in_app', deadlineId: id }).success,
    ).toBe(false);
  });
});
