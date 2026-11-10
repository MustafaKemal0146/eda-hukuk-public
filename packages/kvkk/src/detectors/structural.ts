// Yapısal algılayıcılar (026 §6.3): IBAN, EPOSTA, TCKN, TEL, VKN, PLAKA, TARIH_DOGUM. Desenler `u`
// bayraklı, üst sınırlı niceleyicili ve katlanmış (fold) tarama akışında çalışır; PLAKA özgün BÜYÜK
// harfli akışta. Ön süzgeç: regex yalnız aday konumdan (rakam koşusu başı, `+`, `(`, `@`, `tr`) yapışkan
// (`y`) bayrakla denenir; her deneme pencere uzunluğu kadar adım bütçesinden düşülür (026 §10.3).

import { isValidIban } from '../checksums/iban.ts';
import { isValidPhone } from '../checksums/phone.ts';
import { isValidTckn } from '../checksums/tckn.ts';
import { isValidVkn } from '../checksums/vkn.ts';
import { PLATE_STOPLIST } from '../data/plate-stoplist.ts';
import { isWordChar } from '../fold.ts';
import { type ScanText, scanToNfc } from '../normalize.ts';
import { MONTHS } from '../tokens/canon.ts';
import type { Tip } from '../types.ts';
import { type Candidate, PRIORITY, type StepBudget } from './candidate.ts';

const RX = {
  IBAN: /(?<![\p{L}\p{N}])tr[ .-]?\d{2}(?:[ .-]?\d{4}){5}[ .-]?\d{2}(?![\p{L}\p{N}])/uy,
  EPOSTA:
    /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,4}\.\p{L}{2,24}(?![\p{L}\p{N}-])/uy,
  TCKN: /(?<![\p{L}\p{N}])(?<![.,]\d)[1-9]\d{10}(?![\p{L}\p{N}])(?![.,]\d)/uy,
  TEL: /(?<![\p{L}\p{N}])(?:(?:\+|00)90[ ./-]{0,2}|0[ ./-]{0,2})?(?:\( ?(?:0 ?)?([2-5]\d{2}) ?\)|(?:0 ?)?([2-5]\d{2}))[ ./-]{0,2}(\d{3})[ ./-]{0,2}(\d{2})[ ./-]{0,2}(\d{2})(?![\p{L}\p{N}])(?![.,]\d)/uy,
  VKN: /(?<![\p{L}\p{N}])(?<![.,]\d)\d{10}(?![\p{L}\p{N}])(?![.,]\d)/uy,
  // Ayraçlı rakam dizisi (tek tür ayraç; kod içinde doğrulanır): TCKN 11, VKN 10 hane.
  TCKN_SEP:
    /(?<![\p{L}\p{N}])(?<!\d[ .-])(?<![.,]\d)[1-9](?:[ .-]?\d){10}(?![\p{L}\p{N}])(?![ .-]?\d)(?![.,]\d)/uy,
  VKN_SEP:
    /(?<![\p{L}\p{N}])(?<!\d[ .-])(?<![.,]\d)\d(?:[ .-]?\d){9}(?![\p{L}\p{N}])(?![ .-]?\d)(?![.,]\d)/uy,
  // Gizlenmiş e-posta: yerel[at]alan[dot]uzantı, yerel (at) alan, yerel at alan.uzantı, yerel @ alan.
  EPOSTA_OBF:
    /(?<![\p{L}\p{N}._%+-])([\p{L}\p{N}._%+-]{1,64})(?: ?[[({<] ?at ?[\])}>] ?| @ | at )((?:[\p{L}\p{N}-]{1,63})(?:(?:\.| ?[[({<] ?dot ?[\])}>] ?| dot )[\p{L}\p{N}-]{1,63}){1,4})(?![\p{L}\p{N}-])/gu,
  PLAKA: /(?<![\p{L}\p{N}])(0[1-9]|[1-7]\d|8[01]) ?([A-Z]{1,3}) ?(\d{2,4})(?![\p{L}\p{N}])/uy,
  DATE: new RegExp(
    `(?<!\\d)(?:\\d{1,2}[./-]\\d{1,2}[./-](?:19|20)\\d{2}|\\d{1,2} (?:${MONTHS.join('|')}) (?:19|20)\\d{2})(?!\\d)`,
    'uy',
  ),
} as const;

/** Pencere üst sınırları (karakter): bütçe hesabı ve ön süzgeç. */
const WINDOW = { IBAN: 40, EPOSTA: 400, TCKN: 13, TEL: 26, VKN: 12, PLAKA: 12, DATE: 20 } as const;

const VKN_CONTEXT = ['vkn', 'vergi kimlik', 'vergi no', 'vergi numara', 'v.k.n', 'vergi dairesi'];
const VKN_CONTEXT_CHARS = 32;
const BIRTH_CONTEXT = ['dogum', 'd. tarihi'];
const BIRTH_WINDOW = 48;
const BIRTH_AFTER = 12;

const isDigit = (ch: string): boolean => ch >= '0' && ch <= '9';
const PHONE_CHARS = /^[\d +()./-]$/u;
const SEP_CHARS = new Set([' ', '.', '-']);
const OBF_CUE = /[[({<] ?at ?[\])}>]| at |[\p{L}\p{N}] @ /u;

function digitsOf(s: string): string {
  let out = '';
  for (const ch of s) if (isDigit(ch)) out += ch;
  return out;
}

/** Rakamlar arasında en çok tek tür ayraç (karışık ayraçlı tarih/saat/tutar dizileri TCKN sayılmaz). */
function singleSeparator(s: string): boolean {
  let sep = '';
  for (const ch of s) {
    if (isDigit(ch)) continue;
    if (sep === '') sep = ch;
    else if (sep !== ch) return false;
  }
  return sep !== '';
}

function lastLabel(domain: string): string {
  const parts = domain.split(/\.| ?[[({<] ?dot ?[\])}>] ?| dot /u);
  return parts[parts.length - 1] ?? '';
}

/** E-posta yerel kısmına benzer: nokta, alt çizgi, artı, tire veya rakam içerir. */
function looksLikeLocal(local: string): boolean {
  return /[._%+\d-]/u.test(local);
}

function runLength(s: string, i: number, allowed: (ch: string) => boolean, cap: number): number {
  let n = 0;
  while (i + n < s.length && n < cap && allowed(s.charAt(i + n))) n += 1;
  return n;
}

function tryAt(rx: RegExp, s: string, i: number): RegExpExecArray | null {
  rx.lastIndex = i;
  return rx.exec(s);
}

export interface StructuralOptions {
  kinds: ReadonlySet<Tip>;
  /** VKN bağlam sözcüğü olmadan da (orta güven) maskelenir mi (köken politikası, 026 §5). */
  vknWithoutContext: boolean;
  budget: StepBudget;
}

function lineStartBefore(orig: string, pos: number): number {
  const nl = orig.lastIndexOf('\n', pos - 1);
  return nl < 0 ? 0 : nl + 1;
}

function hasVknContext(scan: ScanText, start: number): boolean {
  const from = Math.max(lineStartBefore(scan.orig, start), start - VKN_CONTEXT_CHARS);
  const w = scan.fold.slice(from, start);
  return VKN_CONTEXT.some((c) => w.includes(c));
}

function add(
  out: Candidate[],
  scan: ScanText,
  a: number,
  b: number,
  tip: Tip,
  priority: number,
  confidence: 'high' | 'medium',
  identitySurface?: string,
): void {
  const [start, end] = scanToNfc(scan, a, b);
  const c: Candidate = { start, end, tip, source: 'pattern', confidence, priority };
  if (identitySurface !== undefined) c.identitySurface = identitySurface;
  out.push(c);
}

export function detectStructural(scan: ScanText, opts: StructuralOptions): Candidate[] {
  const f = scan.fold;
  const o = scan.orig;
  const out: Candidate[] = [];
  const k = opts.kinds;
  const budget = opts.budget;
  for (let i = 0; i < f.length; i += 1) {
    const ch = f.charAt(i);
    const prev = i > 0 ? f.charAt(i - 1) : '';
    const digitRunStart = isDigit(ch) && !isDigit(prev);
    if (digitRunStart) {
      const run = runLength(f, i, isDigit, 64);
      if (k.has('TCKN') && run === 11) {
        budget.charge(Math.min(WINDOW.TCKN, f.length - i));
        const m = tryAt(RX.TCKN, f, i);
        if (m && isValidTckn(m[0]))
          add(out, scan, i, i + m[0].length, 'TCKN', PRIORITY.TCKN, 'high');
      }
      if (
        run < 10 &&
        SEP_CHARS.has(f.charAt(i + run)) &&
        isDigit(f.charAt(i + run + 1)) &&
        (k.has('TCKN') || k.has('VKN'))
      ) {
        // Ayraçlı yazım (boşluk/tire/nokta; NBSP ve Unicode ayraçlar tarama görünümünde katlanmıştır).
        budget.charge(Math.min(24, f.length - i));
        const m = k.has('TCKN') ? tryAt(RX.TCKN_SEP, f, i) : null;
        if (m && singleSeparator(m[0]) && isValidTckn(digitsOf(m[0]))) {
          add(out, scan, i, i + m[0].length, 'TCKN', PRIORITY.TCKN, 'high', digitsOf(m[0]));
        } else if (k.has('VKN')) {
          const v = tryAt(RX.VKN_SEP, f, i);
          if (v && singleSeparator(v[0]) && isValidVkn(digitsOf(v[0]))) {
            // Ayraçlı 10 haneli dizi yalnız VKN bağlam sözcüğüyle (aksi halde tarih/seri no çakışması çok).
            if (hasVknContext(scan, i)) {
              add(
                out,
                scan,
                i,
                i + v[0].length,
                'VKN',
                PRIORITY.VKN_CONTEXT,
                'high',
                digitsOf(v[0]),
              );
            }
          }
        }
      }
      if (k.has('VKN') && run === 10) {
        budget.charge(Math.min(WINDOW.VKN, f.length - i));
        const m = tryAt(RX.VKN, f, i);
        if (m && isValidVkn(m[0])) {
          const ctx = hasVknContext(scan, i);
          if (ctx || opts.vknWithoutContext) {
            add(
              out,
              scan,
              i,
              i + m[0].length,
              'VKN',
              ctx ? PRIORITY.VKN_CONTEXT : PRIORITY.VKN,
              ctx ? 'high' : 'medium',
            );
          }
        }
      }
      if (k.has('PLAKA') && run === 2) {
        budget.charge(Math.min(WINDOW.PLAKA, o.length - i));
        const m = tryAt(RX.PLAKA, o, i);
        if (m) {
          const letters = m[2] ?? '';
          const digits = m[3] ?? '';
          const okCount =
            (letters.length === 1 && digits.length === 4) ||
            (letters.length === 2 && digits.length >= 3) ||
            (letters.length === 3 && digits.length <= 3);
          if (okCount && !/[QWX]/u.test(letters) && !PLATE_STOPLIST.has(letters)) {
            add(out, scan, i, i + m[0].length, 'PLAKA', PRIORITY.PLAKA, 'medium');
          }
        }
      }
      if (k.has('TARIH_DOGUM') && run <= 2) {
        budget.charge(Math.min(WINDOW.DATE, f.length - i));
        const m = tryAt(RX.DATE, f, i);
        if (m) {
          const after = f.slice(i + m[0].length, i + m[0].length + BIRTH_AFTER);
          const ctxStart = Math.max(0, i - BIRTH_WINDOW);
          const before = f.slice(ctxStart, i);
          const hasBefore = BIRTH_CONTEXT.some((c) => {
            const at = before.lastIndexOf(c);
            if (at < 0) return false;
            const abs = ctxStart + at;
            if (abs > 0 && isWordChar(f.charAt(abs - 1))) return false;
            // Bağlamdan sonraki İLK tarih: arada başka tarih yok.
            const between = f.slice(abs + c.length, i);
            return !/\d{1,2}[./-]\d{1,2}[./-](?:19|20)\d{2}/u.test(between);
          });
          if (hasBefore || after.includes('dogumlu')) {
            add(out, scan, i, i + m[0].length, 'TARIH_DOGUM', PRIORITY.TARIH_DOGUM, 'medium');
          }
        }
      }
    }
    if (k.has('TEL') && (digitRunStart || ch === '+' || (ch === '(' && isDigit(f.charAt(i + 1))))) {
      const win = runLength(f, i, (c) => PHONE_CHARS.test(c), WINDOW.TEL);
      budget.charge(win);
      const m = tryAt(RX.TEL, f, i);
      if (m) {
        const national = `${m[1] ?? m[2] ?? ''}${m[3]}${m[4]}${m[5]}`;
        if (isValidPhone(national)) add(out, scan, i, i + m[0].length, 'TEL', PRIORITY.TEL, 'high');
      }
    }
    if (
      k.has('IBAN') &&
      ch === 't' &&
      f.charAt(i + 1) === 'r' &&
      (isDigit(f.charAt(i + 2)) || (SEP_CHARS.has(f.charAt(i + 2)) && isDigit(f.charAt(i + 3))))
    ) {
      budget.charge(Math.min(WINDOW.IBAN, f.length - i));
      const m = tryAt(RX.IBAN, f, i);
      if (m && isValidIban(m[0])) add(out, scan, i, i + m[0].length, 'IBAN', PRIORITY.IBAN, 'high');
    }
    if (k.has('EPOSTA') && ch === '@') {
      const LOCAL = /^[\p{L}\p{N}._%+-]$/u;
      let s = i;
      while (s > 0 && i - s < 64 && LOCAL.test(f.charAt(s - 1))) s -= 1;
      const right = runLength(f, i + 1, (c) => /^[\p{L}\p{N}.-]$/u.test(c), WINDOW.EPOSTA);
      budget.charge(i - s + right + 1);
      if (s < i) {
        const m = tryAt(RX.EPOSTA, f, s);
        if (m && s + m[0].length > i) {
          add(out, scan, s, s + m[0].length, 'EPOSTA', PRIORITY.EPOSTA, 'high');
        }
      }
    }
  }
  if (k.has('EPOSTA') && OBF_CUE.test(f)) {
    budget.charge(f.length);
    for (const m of f.matchAll(RX.EPOSTA_OBF)) {
      const domain = m[2] ?? '';
      const local = m[1] ?? '';
      const bracketed = /[[({<]/u.test(m[0]) || m[0].includes(' @ ');
      if (!/^\p{L}{2,24}$/u.test(lastLabel(domain))) continue;
      // Serbest ` at ` yalnız e-posta yerel kısmına benzeyen sözcükte ve noktalı alan adında (sıradan
      // cümledeki "at" sözcüğü maskelenmez); köşeli/parantezli ve boşluklu '@' biçimleri her zaman.
      if (!bracketed && !looksLikeLocal(local)) continue;
      add(out, scan, m.index, m.index + m[0].length, 'EPOSTA', PRIORITY.EPOSTA, 'high');
    }
  }
  return out;
}
