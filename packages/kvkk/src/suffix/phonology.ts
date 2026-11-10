// Gövde ses bilgisi (026 §7.5 (2)): görünen değerin son sözcüğünden son ünlü, ünlüyle bitme ve sert
// ünsüzle bitme. Kısaltma/akronim ve rakamla biten değerlerde okunuş tablosu kullanılır.
import { foldChars, isLetterChar, isTrUpper, trLower } from '../fold.ts';
import type { Tip } from '../types.ts';
import { FRONT_HARMONY_EXCEPTIONS } from './exceptions.ts';

export type Vowel = 'a' | 'e' | 'ı' | 'i' | 'o' | 'ö' | 'u' | 'ü';

export interface StemInfo {
  lastVowel: Vowel;
  endsWithVowel: boolean;
  hardEnd: boolean;
}

const VOWEL_MAP: Readonly<Record<string, Vowel>> = {
  a: 'a',
  e: 'e',
  ı: 'ı',
  i: 'i',
  o: 'o',
  ö: 'ö',
  u: 'u',
  ü: 'ü',
  â: 'a',
  î: 'i',
  û: 'u',
};
const HARD = new Set(['ç', 'f', 'h', 'k', 'p', 's', 'ş', 't']);

/** Harf adları (026 §7.5 tablo). */
export const LETTER_NAMES: Readonly<Record<string, string>> = {
  A: 'a',
  B: 'be',
  C: 'ce',
  Ç: 'çe',
  D: 'de',
  E: 'e',
  F: 'fe',
  G: 'ge',
  Ğ: 'yumuşak ge',
  H: 'he',
  I: 'ı',
  İ: 'i',
  J: 'je',
  K: 'ke',
  L: 'le',
  M: 'me',
  N: 'ne',
  O: 'o',
  Ö: 'ö',
  P: 'pe',
  R: 're',
  S: 'se',
  Ş: 'şe',
  T: 'te',
  U: 'u',
  Ü: 'ü',
  V: 've',
  Y: 'ye',
  Z: 'ze',
  Q: 'kü',
  W: 'dabılyu',
  X: 'iks',
};

const LETTER_KEY: ReadonlyMap<string, string> = new Map(
  Object.keys(LETTER_NAMES).map((k) => [trLower(k), k] as const),
);

/** Rakam okunuşları (026 §7.5 tablo). */
export const DIGIT_NAMES: Readonly<Record<string, string>> = {
  '0': 'sıfır',
  '1': 'bir',
  '2': 'iki',
  '3': 'üç',
  '4': 'dört',
  '5': 'beş',
  '6': 'altı',
  '7': 'yedi',
  '8': 'sekiz',
  '9': 'dokuz',
};

const FRONT_OF: Readonly<Record<Vowel, Vowel>> = {
  a: 'e',
  ı: 'i',
  o: 'ö',
  u: 'ü',
  e: 'e',
  i: 'i',
  ö: 'ö',
  ü: 'ü',
};

/** Küçük harfli düz sözcüğün ses bilgisi. Ünlüsü yoksa son harfin okunuşuna düşer. */
export function wordStem(word: string): StemInfo | null {
  const w = trLower(word);
  let lastVowel: Vowel | null = null;
  let lastLetter = '';
  for (const ch of w) {
    if (!isLetterChar(ch)) continue;
    lastLetter = ch;
    const v = VOWEL_MAP[ch];
    if (v) lastVowel = v;
  }
  if (lastVowel === null || lastLetter === '') return null;
  let vowel = lastVowel;
  if (FRONT_HARMONY_EXCEPTIONS.has(foldChars(w))) vowel = FRONT_OF[vowel];
  return {
    lastVowel: vowel,
    endsWithVowel: VOWEL_MAP[lastLetter] !== undefined,
    hardEnd: HARD.has(lastLetter),
  };
}

function letterReading(upperLetter: string): StemInfo {
  const name = LETTER_NAMES[upperLetter] ?? 'e';
  return wordStem(name) ?? { lastVowel: 'e', endsWithVowel: true, hardEnd: false };
}

function digitReading(d: string): StemInfo {
  return (
    wordStem(DIGIT_NAMES[d] ?? 'bir') ?? { lastVowel: 'i', endsWithVowel: false, hardEnd: false }
  );
}

function hasVowel(word: string): boolean {
  for (const ch of trLower(word)) if (VOWEL_MAP[ch]) return true;
  return false;
}

function trailingTrim(s: string): string {
  let end = s.length;
  while (end > 0) {
    const ch = s.charAt(end - 1);
    if (isLetterChar(ch) || (ch >= '0' && ch <= '9') || ch === '.') break;
    end -= 1;
  }
  return s.slice(0, end);
}

/** Görünen değerin son sözcüğüne göre ses bilgisi (026 §7.5 (2)). */
export function stemInfo(display: string, tip: Tip): StemInfo {
  const words = display.trim().split(/\s{1,64}/u);
  const lastRaw = trailingTrim(words[words.length - 1] ?? '');
  // Son anlamlı karakter (noktalar atlanarak).
  let lastChar = '';
  for (let i = lastRaw.length - 1; i >= 0; i -= 1) {
    const ch = lastRaw.charAt(i);
    if (ch !== '.') {
      lastChar = ch;
      break;
    }
  }
  if (lastChar >= '0' && lastChar <= '9') return digitReading(lastChar);
  if (tip === 'EPOSTA') {
    const runs = display.match(/\p{L}{1,64}/gu) ?? [];
    const lastRun = runs[runs.length - 1] ?? '';
    return wordStem(lastRun) ?? letterReading('E');
  }
  const word = lastRaw.replace(/^['’]{1,4}/u, '');
  const letters = [...word].filter((c) => isLetterChar(c));
  const last = letters[letters.length - 1];
  if (last === undefined) return { lastVowel: 'e', endsWithVowel: true, hardEnd: false };
  const isAbbrev = word.includes('.');
  const isAcronym =
    letters.length >= 2 &&
    letters.every((c) => isTrUpper(c) || /^[QWX]$/u.test(c)) &&
    !hasVowel(word);
  if (isAbbrev || isAcronym) {
    const upper = isTrUpper(last) || /^[QWX]$/u.test(last) ? last : (LETTER_KEY.get(last) ?? last);
    return letterReading(upper);
  }
  return wordStem(word) ?? letterReading(LETTER_KEY.get(last) ?? last);
}

export function harmony2(v: Vowel): 'a' | 'e' {
  return v === 'a' || v === 'ı' || v === 'o' || v === 'u' ? 'a' : 'e';
}

export function harmony4(v: Vowel): 'ı' | 'i' | 'u' | 'ü' {
  if (v === 'a' || v === 'ı') return 'ı';
  if (v === 'e' || v === 'i') return 'i';
  if (v === 'o' || v === 'u') return 'u';
  return 'ü';
}
