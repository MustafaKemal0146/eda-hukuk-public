// Süre Kilidi (083 §11.4, 022 §3.11; P22 K5). Asistan metnindeki süre ve tarih ifadelerini çıkarır
// ve o turdaki `calculate_deadline` sonuçlarıyla KARŞILAŞTIRIR; hesap yapmaz. Bağlam ve dışlama
// listeleri başlangıçtır (083 Açık Soru 10; eval ile genişler, 027 H-DLOCK).
// Eşleme `tr_fold` metni üzerindedir; dışlama sözcükleri ş/s ayrımı için `tr_normalize` metninde aranır.
import type { DeadlineCheckStatus } from '@eda/contracts/enums';
import { normalizeWithMap } from '../text/index.ts';
import { isValidIso } from './civil-date.ts';

export type DurationUnitExpr = 'day' | 'week' | 'month' | 'year';

export type DeadlineExpression =
  | {
      readonly kind: 'duration';
      /** Özgün metin dilimi (`data-deadline-checks.checks[].text`). */
      readonly text: string;
      readonly start: number;
      readonly end: number;
      readonly value: number;
      readonly unit: DurationUnitExpr;
    }
  | {
      readonly kind: 'date';
      readonly text: string;
      readonly start: number;
      readonly end: number;
      /** `YYYY-MM-DD`. */
      readonly date: string;
    };

/** Karşılaştırılacak hesap (motor çıktısının alt kümesi). */
export type LockCalculation = {
  readonly calculationId: string;
  readonly durationValue: number;
  readonly durationUnit: 'day' | 'week' | 'month';
  readonly dueDate: string;
  readonly contestedDueDate: string | null;
  readonly safeDueAt: string | null;
};

export type DeadlineCheck = {
  checkId: string;
  text: string;
  status: DeadlineCheckStatus;
  calculationId?: string;
};

/** 083 §11.4 sayı sözcükleri (katlanmış). */
const NUMBER_WORDS: ReadonlyArray<readonly [string, number]> = [
  ['kirk bes', 45],
  ['on bes', 15],
  ['altmis', 60],
  ['doksan', 90],
  ['yirmi', 20],
  ['otuz', 30],
  ['sekiz', 8],
  ['dokuz', 9],
  ['bir', 1],
  ['iki', 2],
  ['uc', 3],
  ['dort', 4],
  ['bes', 5],
  ['alti', 6],
  ['yedi', 7],
  ['on', 10],
];

const UNIT_WORDS: Readonly<Record<string, DurationUnitExpr>> = {
  gun: 'day',
  hafta: 'week',
  ay: 'month',
  yil: 'year',
};

const MONTHS: Readonly<Record<string, number>> = {
  ocak: 1,
  subat: 2,
  mart: 3,
  nisan: 4,
  mayis: 5,
  haziran: 6,
  temmuz: 7,
  agustos: 8,
  eylul: 9,
  ekim: 10,
  kasim: 11,
  aralik: 12,
};

/** Bağlam sözcükleri (±60 karakter; katlanmış, sözcük başında). */
export const LOCK_CONTEXT_WORDS = [
  'sure',
  'suresi',
  'suresinde',
  'icinde',
  'itiraz',
  'istinaf',
  'temyiz',
  'cevap',
  'dava acma',
  'son gun',
  'en gec',
  'basvuru',
  'teblig',
  'tefhim',
] as const;

/** Dışlama sözcükleri (±40 karakter; Türkçe küçük harf, sözcük başında). */
export const LOCK_EXCLUSION_WORDS = [
  'hapis',
  'yaş',
  'faiz',
  'kıdem',
  'ihbar',
  'ücret',
  'kira bedeli',
  'taksit',
  'gün karşılığı',
  'adli para',
] as const;

export const LOCK_CONTEXT_WINDOW = 60;
export const LOCK_EXCLUSION_WINDOW = 40;

const FOLD: Readonly<Record<string, string>> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' };

/**
 * Birimden sonra izin verilen yaygın ekler (katlanmış): ek-fiil (-dır), bulunma/ayrılma/yönelme ve
 * belirtme/tamlayan (14 gündür, 2 haftada, 1 aya, günü). 083 §11.4 başlangıç listesi yalnız -lık'ı
 * sayar; bu genişleme kaydındadır. "ayrıca" gibi sözcükler listede olmadığı için eşleşmez.
 */
const CASE_SUFFIXES = [
  'dir',
  'dur',
  'tir',
  'tur',
  'den',
  'dan',
  'ten',
  'tan',
  'de',
  'da',
  'te',
  'ta',
  'yin',
  'yun',
  'nin',
  'nun',
  'in',
  'un',
  'yi',
  'yu',
  'ye',
  'ya',
  'i',
  'u',
  'e',
  'a',
].join('|');

const NUM_ALT = NUMBER_WORDS.map(([w]) => w).join('|');
const DURATION_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.])(\\d{1,3}|${NUM_ALT}) (gun|hafta|ay|yil)(?:lik|luk)?(?:${CASE_SUFFIXES})?(?![\\p{L}\\p{N}])`,
  'gu',
);
const NUMERIC_DATE_RE = /(?<![\p{N}.])(\d{1,2})[./](\d{1,2})[./](\d{4})(?![\p{N}])/gu;
const LONG_DATE_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(\\d{1,2}) (${Object.keys(MONTHS).join('|')})(?:[\\p{L}']*)? (\\d{4})(?![\\p{N}])`,
  'gu',
);

function isoOf(y: number, m: number, d: number): string | null {
  const iso = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isValidIso(iso) ? iso : null;
}

/** `word` metinde [from, to) aralığında bir sözcük başında geçiyor mu. */
function hasWordAt(text: string, word: string, from: number, to: number): boolean {
  const lo = Math.max(0, from);
  const hi = Math.min(text.length, to);
  let i = text.indexOf(word, lo);
  while (i >= 0 && i + word.length <= hi) {
    const prev = i === 0 ? ' ' : text.charAt(i - 1);
    if (!/[\p{L}\p{N}]/u.test(prev)) return true;
    i = text.indexOf(word, i + 1);
  }
  return false;
}

type Candidate = { start: number; end: number } & (
  | { kind: 'duration'; value: number; unit: DurationUnitExpr }
  | { kind: 'date'; date: string }
);

/**
 * Metindeki aday süre/tarih ifadeleri: bağlam sözcüğü ±60 karakterde olmalı, dışlama sözcüğü ±40
 * karakterde olmamalı. Ofsetler özgün metne göredir; sonuç sırası metindeki sıradır.
 */
export function extractDeadlineExpressions(text: string): DeadlineExpression[] {
  const { norm, map } = normalizeWithMap(text);
  const folded = norm.replace(/[çğıöşü]/g, (c) => FOLD[c] ?? c);
  const found: Candidate[] = [];
  for (const m of folded.matchAll(DURATION_RE)) {
    const raw = m[1] ?? '';
    const value = /^\d+$/.test(raw)
      ? Number(raw)
      : (NUMBER_WORDS.find(([w]) => w === raw)?.[1] ?? 0);
    const unit = UNIT_WORDS[m[2] ?? ''];
    if (value <= 0 || unit === undefined) continue;
    found.push({ kind: 'duration', start: m.index, end: m.index + m[0].length, value, unit });
  }
  for (const m of folded.matchAll(NUMERIC_DATE_RE)) {
    const date = isoOf(Number(m[3]), Number(m[2]), Number(m[1]));
    if (date !== null)
      found.push({ kind: 'date', start: m.index, end: m.index + m[0].length, date });
  }
  for (const m of folded.matchAll(LONG_DATE_RE)) {
    const date = isoOf(Number(m[3]), MONTHS[m[2] ?? ''] ?? 0, Number(m[1]));
    if (date !== null)
      found.push({ kind: 'date', start: m.index, end: m.index + m[0].length, date });
  }
  found.sort((a, b) => a.start - b.start);
  const out: DeadlineExpression[] = [];
  for (const c of found) {
    const ctxFrom = c.start - LOCK_CONTEXT_WINDOW;
    const ctxTo = c.end + LOCK_CONTEXT_WINDOW;
    const inContext = LOCK_CONTEXT_WORDS.some(
      (w) => hasWordAt(folded, w, ctxFrom, c.start) || hasWordAt(folded, w, c.end, ctxTo),
    );
    if (!inContext) continue;
    const exFrom = c.start - LOCK_EXCLUSION_WINDOW;
    const exTo = c.end + LOCK_EXCLUSION_WINDOW;
    const excluded = LOCK_EXCLUSION_WORDS.some((w) => hasWordAt(norm, w, exFrom, exTo));
    if (excluded) continue;
    const oStart = map[c.start] ?? 0;
    const oEnd = (map[c.end - 1] ?? oStart) + 1;
    const slice = text.slice(oStart, oEnd);
    if (c.kind === 'duration') {
      out.push({
        kind: 'duration',
        text: slice,
        start: oStart,
        end: oEnd,
        value: c.value,
        unit: c.unit,
      });
    } else {
      out.push({ kind: 'date', text: slice, start: oStart, end: oEnd, date: c.date });
    }
  }
  return out;
}

/** Gün ve hafta karşılıklı çevrilir (14 gün = 2 hafta); ay çevrilmez; 1 yıl = 12 ay (083 §2.1). */
function durationMatches(
  e: Extract<DeadlineExpression, { kind: 'duration' }>,
  c: LockCalculation,
): boolean {
  if (e.unit === 'day' || e.unit === 'week') {
    if (c.durationUnit === 'month') return false;
    const exprDays = e.unit === 'week' ? e.value * 7 : e.value;
    const calcDays = c.durationUnit === 'week' ? c.durationValue * 7 : c.durationValue;
    return exprDays === calcDays;
  }
  if (c.durationUnit !== 'month') return false;
  const exprMonths = e.unit === 'year' ? e.value * 12 : e.value;
  return exprMonths === c.durationValue;
}

function dateMatches(date: string, c: LockCalculation): boolean {
  return (
    date === c.dueDate ||
    date === c.contestedDueDate ||
    (c.safeDueAt !== null && date === c.safeDueAt.slice(0, 10))
  );
}

/**
 * İfade başına durum: hesap yoksa `no_calculation`; bir hesapla eşleşirse `match` (ilk eşleşen
 * hesabın kimliğiyle); aksi `mismatch`. Süre Kilidi hesabı doğru kabul eder (083 §11.4).
 */
export function compareWithCalculations(
  exprs: readonly DeadlineExpression[],
  calcs: readonly LockCalculation[],
): DeadlineCheck[] {
  return exprs.map((e, i) => {
    const checkId = `dc-${i + 1}`;
    if (calcs.length === 0) return { checkId, text: e.text, status: 'no_calculation' };
    const hit = calcs.find((c) =>
      e.kind === 'duration' ? durationMatches(e, c) : dateMatches(e.date, c),
    );
    return hit === undefined
      ? { checkId, text: e.text, status: 'mismatch' }
      : { checkId, text: e.text, status: 'match', calculationId: hit.calculationId };
  });
}

/** Metin -> `data-deadline-checks.checks[]`; aday ifade yoksa boş dizi (parça yazılmaz). */
export function checkDeadlineText(
  text: string,
  calcs: readonly LockCalculation[],
): DeadlineCheck[] {
  return compareWithCalculations(extractDeadlineExpressions(text), calcs);
}
