// Bağımsız referans yürüyücü (P22.4): motorun sivil-tarih yardımcılarını PAYLAŞMAZ; günleri UTC
// milisaniye ile tek tek yürür ve tatil fixture'ını ham biçimiyle ([start, endExclusive)) okur.
// Yalnız kaydırmalı profiller (P-HMK, P-HMK-NR, P-IIK, P-IIK-GM, P-CMK, P-IYUK) için 083 §5.2'nin
// ikinci bir okumasıdır; motorla çapraz karşılaştırılır. Üretim kodunda kullanılmaz.
import type { HolidayFixture } from './deadline/helpers.ts';

const DAY = 86_400_000;

function ms(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function iso(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

export type WalkerRule = {
  durationValue: number;
  durationUnit: 'day' | 'week' | 'month';
  recessBranch: 'hmk' | 'cmk' | 'iyuk' | null;
  recessExtensionDays: number | null;
};

export type WalkerResult = {
  dueDate: string;
  contestedDueDate: string | null;
  recessApplied: boolean;
};

export function makeWalker(fixture: HolidayFixture) {
  const full = new Set<number>();
  const half = new Set<number>();
  for (const h of fixture.holidays) {
    if (h.kind === 'administrative_leave') continue;
    (h.isHalfDay ? half : full).add(ms(h.date));
  }
  const offDay = (t: number): boolean => {
    const wd = new Date(t).getUTCDay(); // 0 = Pazar, 6 = Cumartesi
    return wd === 0 || wd === 6 || full.has(t);
  };
  const walkToWorking = (t: number): number => {
    let x = t;
    while (offDay(x)) x += DAY;
    return x;
  };
  const recessAt = (branch: string, t: number) => {
    const y = new Date(t).getUTCFullYear();
    const r = fixture.recesses.find((x) => x.branch === branch && x.year === y);
    if (r === undefined) return null;
    const start = ms(r.start);
    const endEx = ms(r.endExclusive);
    return t >= start && t < endEx ? { lastDay: endEx - DAY } : null;
  };

  return function walk(rule: WalkerRule, eventDate: string, eTebligat: boolean): WalkerResult {
    let s = ms(eventDate);
    if (eTebligat) for (let i = 0; i < 5; i++) s += DAY;
    let e = s;
    if (rule.durationUnit === 'month') {
      const d0 = new Date(s);
      const y = d0.getUTCFullYear();
      const m = d0.getUTCMonth() + rule.durationValue;
      const lastOfTarget = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      e = Date.UTC(y, m, Math.min(d0.getUTCDate(), lastOfTarget));
    } else {
      const n = rule.durationUnit === 'week' ? rule.durationValue * 7 : rule.durationValue;
      for (let i = 0; i < n; i++) e += DAY;
    }
    let shifted = false;
    let pre: number | null = null;
    let recessApplied = false;
    for (let round = 0; round < 8; round++) {
      let changed = false;
      if (rule.recessBranch !== null && rule.recessExtensionDays !== null) {
        const r = recessAt(rule.recessBranch, e);
        if (r !== null) {
          if (shifted && pre === null) pre = e;
          e = r.lastDay;
          for (let i = 0; i < rule.recessExtensionDays; i++) e += DAY;
          recessApplied = true;
          changed = true;
        }
      }
      if (offDay(e)) {
        e = walkToWorking(e);
        shifted = true;
        changed = true;
      }
      if (!changed) break;
    }
    if (half.has(e)) {
      return { dueDate: iso(e), contestedDueDate: iso(walkToWorking(e + DAY)), recessApplied };
    }
    if (pre !== null) return { dueDate: iso(pre), contestedDueDate: iso(e), recessApplied };
    return { dueDate: iso(e), contestedDueDate: null, recessApplied };
  };
}
