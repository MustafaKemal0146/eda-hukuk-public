// Serbest algılanan değerin kimliği `canon(tip, yüzey)` (026 §4.4).
import { deobfuscateEmail, foldCompatString } from '../compat.ts';
import { asciiLower, asciiUpper, foldChars, isIgnorableCode } from '../fold.ts';
import type { Tip } from '../types.ts';

const MONTHS = [
  'ocak',
  'subat',
  'mart',
  'nisan',
  'mayis',
  'haziran',
  'temmuz',
  'agustos',
  'eylul',
  'ekim',
  'kasim',
  'aralik',
] as const;

function digitsOnly(s: string): string {
  let out = '';
  for (const ch of s) if (ch >= '0' && ch <= '9') out += ch;
  return out;
}

function dropIgnorable(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (!isIgnorableCode(s.charCodeAt(i))) out += s.charAt(i);
  }
  return out;
}

/** Katlanmış, noktalama (. ,) atılmış, tek boşluklu metin kimliği. */
export function textCanon(surface: string): string {
  const f = foldChars(dropIgnorable(surface));
  let out = '';
  let space = false;
  for (const ch of f) {
    if (ch === '.' || ch === ',') {
      space = out.length > 0;
      continue;
    }
    if (ch === ' ') {
      space = out.length > 0;
      continue;
    }
    if (space) out += ' ';
    space = false;
    out += ch;
  }
  return out;
}

/** Ulusal 10 hane (TR telefon). */
export function phoneNational(surface: string): string {
  const d = digitsOnly(surface);
  return d.slice(-10);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function dateCanon(surface: string): string {
  const f = foldChars(surface);
  const num = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/u.exec(f.trim());
  if (num) {
    return `${num[3]}-${pad2(Number(num[2]))}-${pad2(Number(num[1]))}`;
  }
  const words = /^(\d{1,2}) {1,4}(\p{L}{3,8}) {1,4}(\d{4})$/u.exec(f.trim());
  if (words) {
    const m = MONTHS.indexOf((words[2] ?? '') as (typeof MONTHS)[number]);
    if (m >= 0) return `${words[3]}-${pad2(m + 1)}-${pad2(Number(words[1]))}`;
  }
  return textCanon(surface);
}

export function canon(tip: Tip, rawSurface: string): string {
  // Tarama görünümüyle aynı katlama (NFKC, Unicode rakam, homoglif): aynı değerin farklı yazımı aynı kimliği verir.
  const surface = foldCompatString(rawSurface);
  switch (tip) {
    case 'TCKN':
    case 'VKN':
      return digitsOnly(surface);
    case 'TEL':
      return `+90${phoneNational(surface)}`;
    case 'EPOSTA':
      return asciiLower(deobfuscateEmail(dropIgnorable(surface).trim()).replace(/\s/gu, ''));
    case 'IBAN':
    case 'PLAKA':
      return asciiUpper(dropIgnorable(surface).replace(/[\s.-]/gu, ''));
    case 'TARIH_DOGUM':
      return dateCanon(surface);
    default:
      return textCanon(surface);
  }
}

export { MONTHS };
