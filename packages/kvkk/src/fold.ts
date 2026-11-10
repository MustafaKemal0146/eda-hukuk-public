// Uzunluk koruyan Türkçe katlama ve harf tabloları (026 §2). JS toLowerCase/toUpperCase ailesi ve
// RegExp `i` bayrağı kullanılmaz (Y-104): tüm büyük/küçük harf dönüşümü buradaki yerelden bağımsız
// tablolarla yapılır. @eda/legal `tr_fold` uzunluğu değiştirebildiği için eşleşme kodu bu modülü kullanır
// (026 §1.1).

const SIZE = 0x10000;

function buildLower(): Uint16Array {
  const t = new Uint16Array(SIZE);
  for (let c = 0; c < SIZE; c += 1) t[c] = c;
  for (let c = 0x41; c <= 0x5a; c += 1) t[c] = c + 0x20;
  t[0x49] = 0x131; // I -> ı (Türkçe)
  t[0x130] = 0x69; // İ -> i
  for (let c = 0xc0; c <= 0xde; c += 1) if (c !== 0xd7) t[c] = c + 0x20;
  for (let c = 0x100; c <= 0x137; c += 2) if (c !== 0x130) t[c] = c + 1;
  for (let c = 0x139; c <= 0x147; c += 2) t[c] = c + 1;
  for (let c = 0x14a; c <= 0x176; c += 2) t[c] = c + 1;
  t[0x178] = 0xff;
  for (let c = 0x179; c <= 0x17d; c += 2) t[c] = c + 1;
  for (let c = 0x391; c <= 0x3a9; c += 1) if (c !== 0x3a2) t[c] = c + 0x20;
  for (let c = 0x410; c <= 0x42f; c += 1) t[c] = c + 0x20;
  for (let c = 0x400; c <= 0x40f; c += 1) t[c] = c + 0x50;
  return t;
}

function buildUpper(lower: Uint16Array): Uint16Array {
  const t = new Uint16Array(SIZE);
  for (let c = 0; c < SIZE; c += 1) t[c] = c;
  for (let c = 0; c < SIZE; c += 1) {
    const l = lower[c] ?? c;
    if (l !== c && c !== 0x130 && c !== 0x49) t[l] = c;
  }
  t[0x69] = 0x130; // i -> İ
  t[0x131] = 0x49; // ı -> I
  return t;
}

const WHITESPACE = new Set<number>([
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006,
  0x2007, 0x2008, 0x2009, 0x200a, 0x202f, 0x205f, 0x3000, 0x85, 0x1680, 0x2028, 0x2029,
]);
/**
 * Görünmeyen biçim karakterleri (Unicode Cf: sıfır genişlikli, yön işaretleri, 2060-2064 ...), değişim
 * seçicileri (FE00-FE0F), birleştirme bağlayıcısı (034F) ve Hangul dolgu karakterleri. Algılamada atlanır.
 */
const IGNORABLE = (() => {
  const set = new Set<number>([
    0x34f, 0x115f, 0x1160, 0x3164, 0xffa0, 0x180b, 0x180c, 0x180d, 0x180f,
  ]);
  const cf = /^\p{Cf}$/u;
  for (let c = 0; c < 0x10000; c += 1) {
    if (c >= 0xd800 && c <= 0xdfff) continue;
    if (cf.test(String.fromCharCode(c))) set.add(c);
  }
  for (let c = 0xfe00; c <= 0xfe0f; c += 1) set.add(c);
  set.delete(0xfffc);
  return set;
})();
const DIACRITIC: ReadonlyArray<readonly [number, number]> = [
  [0xe7, 0x63], // ç -> c
  [0x11f, 0x67], // ğ -> g
  [0x131, 0x69], // ı -> i
  [0xf6, 0x6f], // ö -> o
  [0x15f, 0x73], // ş -> s
  [0xfc, 0x75], // ü -> u
  [0xe2, 0x61], // â -> a
  [0xee, 0x69], // î -> i
  [0xfb, 0x75], // û -> u
];
const QUOTES = [0x2019, 0x2018, 0xb4, 0x60];

const LOWER = buildLower();
const UPPER = buildUpper(LOWER);
const FOLD = (() => {
  const t = new Uint16Array(SIZE);
  for (let c = 0; c < SIZE; c += 1) t[c] = LOWER[c] ?? c;
  for (const [from, to] of DIACRITIC) {
    for (let c = 0; c < SIZE; c += 1) if (t[c] === from) t[c] = to;
  }
  for (const q of QUOTES) t[q] = 0x27;
  for (const w of WHITESPACE) t[w] = 0x20;
  return t;
})();

function mapString(s: string, table: Uint16Array): string {
  const n = s.length;
  if (n === 0) return s;
  const out = new Uint16Array(n);
  for (let i = 0; i < n; i += 1) {
    const c = s.charCodeAt(i);
    out[i] = table[c] ?? c;
  }
  let res = '';
  const CHUNK = 8192;
  for (let i = 0; i < n; i += CHUNK) {
    res += String.fromCharCode(...out.subarray(i, Math.min(n, i + CHUNK)));
  }
  return res;
}

/** Kod birimi başına tam bir çıktı birimi: Türkçe küçük harf + aksan katlama + tırnak + boşluk. */
export function foldChars(s: string): string {
  return mapString(s, FOLD);
}

export function foldCode(c: number): number {
  return FOLD[c] ?? c;
}

/** Türkçe kurallı küçük harf (İ->i, I->ı); uzunluk korunur. */
export function trLower(s: string): string {
  return mapString(s, LOWER);
}

/** Türkçe kurallı büyük harf (i->İ, ı->I); uzunluk korunur. */
export function trUpper(s: string): string {
  return mapString(s, UPPER);
}

/** Sözcük başına Title-case (Türkçe tablolarla). */
export function trTitle(s: string): string {
  let out = '';
  let start = true;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charAt(i);
    const c = s.charCodeAt(i);
    if (isLetterChar(ch)) {
      out += String.fromCharCode(start ? (UPPER[c] ?? c) : (LOWER[c] ?? c));
      start = false;
    } else {
      out += ch;
      start = ch === ' ' || ch === '-' || WHITESPACE.has(c);
    }
  }
  return out;
}

const ASCII_UPPER_A = 0x41;
const ASCII_UPPER_Z = 0x5a;
const ASCII_LOWER_A = 0x61;
const ASCII_LOWER_Z = 0x7a;

/** Yalnız ASCII A-Z -> a-z (e-posta, UUID gibi ASCII kimlikler; Türkçe metin değil). */
export function asciiLower(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    out += String.fromCharCode(c >= ASCII_UPPER_A && c <= ASCII_UPPER_Z ? c + 0x20 : c);
  }
  return out;
}

/** Yalnız ASCII a-z -> A-Z (token grameri, IBAN, plaka). */
export function asciiUpper(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    out += String.fromCharCode(c >= ASCII_LOWER_A && c <= ASCII_LOWER_Z ? c - 0x20 : c);
  }
  return out;
}

export function isWhitespaceCode(c: number): boolean {
  return WHITESPACE.has(c);
}

export function isIgnorableCode(c: number): boolean {
  return IGNORABLE.has(c);
}

/** Astral düzlemde görünmeyen karakter (etiket karakterleri E0000-E007F, değişim seçicileri E0100-E01EF). */
export function isIgnorableCodePoint(cp: number): boolean {
  if (cp < 0x10000) return IGNORABLE.has(cp);
  return (
    (cp >= 0xe0000 && cp <= 0xe007f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef) ||
    cp === 0x1d173 ||
    (cp >= 0x1d173 && cp <= 0x1d17a) ||
    (cp >= 0x1bca0 && cp <= 0x1bca3)
  );
}

const LETTER = /^\p{L}$/u;
const LETTER_OR_DIGIT = /^[\p{L}\p{N}]$/u;

export function isLetterChar(ch: string): boolean {
  return ch.length === 1 && LETTER.test(ch);
}

export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && ch.length === 1 && LETTER_OR_DIGIT.test(ch);
}

/** 026 §2 adım 6: TR_UPPER = [A-ZÇĞİÖŞÜ], TR_LOWER = [a-zçğıöşü]. */
export const TR_UPPER_CLASS = 'A-ZÇĞİÖŞÜ';
export const TR_LOWER_CLASS = 'a-zçğıöşü';
const TR_UPPER_RE = new RegExp(`^[${TR_UPPER_CLASS}]$`, 'u');
const TR_LOWER_RE = new RegExp(`^[${TR_LOWER_CLASS}]$`, 'u');

export function isTrUpper(ch: string): boolean {
  return TR_UPPER_RE.test(ch);
}

export function isTrLower(ch: string): boolean {
  return TR_LOWER_RE.test(ch);
}

/** Metin en az iki harf içeriyor ve küçük harf içermiyorsa true (ek uyumlayıcı ve display kuralı). */
export function isAllUpper(s: string): boolean {
  let letters = 0;
  for (const ch of s) {
    if (!isLetterChar(ch)) continue;
    letters += 1;
    const c = ch.charCodeAt(0);
    if ((LOWER[c] ?? c) === c && (UPPER[c] ?? c) !== c) return false;
  }
  return letters >= 2;
}
