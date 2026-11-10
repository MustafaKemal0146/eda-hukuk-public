// Tarama görünümü için uyumluluk katlaması (026 §2 genişletmesi, KK-026-27): algılayıcılar, özgün metinde
// değişiklik yapılmadan, şu kaçırma biçimlerine karşı bu katlanmış görünüm üzerinde çalışır:
//   - NFKC (tam genişlik, matematiksel yazı, uyumluluk ligatürleri)
//   - Unicode ondalık rakamlar (Arapça-Hint, Doğu Arap, Devanagari ...) -> ASCII rakam
//   - tire/nokta benzeri ayraçlar -> '-' / '.'
//   - Kiril/Yunan homoglifleri -> Latin; YALNIZ Latin harf/rakam içeren sözcükte (karışık yazı), böylece
//     düz Kiril/Yunan metin (masum sözcükler) olduğu gibi kalır.
// Saf işlevlerdir; indeks eşlemesi `buildScan` içinde tutulur (tarama konumu -> NFC ofseti).

/** Kiril/Yunan -> Latin benzer karakterler (büyük/küçük harf korunur). */
const HOMOGLYPHS: ReadonlyMap<number, string> = new Map<number, string>([
  // Kiril büyük
  [0x410, 'A'],
  [0x412, 'B'],
  [0x415, 'E'],
  [0x41a, 'K'],
  [0x41c, 'M'],
  [0x41d, 'H'],
  [0x41e, 'O'],
  [0x420, 'P'],
  [0x421, 'C'],
  [0x422, 'T'],
  [0x423, 'Y'],
  [0x425, 'X'],
  [0x406, 'I'],
  [0x408, 'J'],
  [0x405, 'S'],
  [0x4c0, 'I'],
  [0x4ae, 'Y'],
  [0x4bb, 'h'],
  [0x4a0, 'K'],
  // Kiril küçük
  [0x430, 'a'],
  [0x435, 'e'],
  [0x43e, 'o'],
  [0x440, 'p'],
  [0x441, 'c'],
  [0x443, 'y'],
  [0x445, 'x'],
  [0x456, 'i'],
  [0x458, 'j'],
  [0x455, 's'],
  [0x501, 'd'],
  [0x51b, 'q'],
  [0x51d, 'w'],
  [0x4cf, 'l'],
  [0x4af, 'y'],
  [0x44c, 'b'],
  [0x43a, 'k'],
  [0x43d, 'h'],
  [0x442, 't'],
  [0x432, 'v'],
  [0x43c, 'm'],
  [0x438, 'u'],
  [0x4d1, 'a'],
  [0x4d5, 'e'],
  [0x4e7, 'o'],
  [0x4f1, 'y'],
  // Yunan büyük
  [0x391, 'A'],
  [0x392, 'B'],
  [0x395, 'E'],
  [0x396, 'Z'],
  [0x397, 'H'],
  [0x399, 'I'],
  [0x39a, 'K'],
  [0x39c, 'M'],
  [0x39d, 'N'],
  [0x39f, 'O'],
  [0x3a1, 'P'],
  [0x3a4, 'T'],
  [0x3a5, 'Y'],
  [0x3a7, 'X'],
  // Yunan küçük
  [0x3b1, 'a'],
  [0x3b5, 'e'],
  [0x3b9, 'i'],
  [0x3ba, 'k'],
  [0x3bd, 'v'],
  [0x3bf, 'o'],
  [0x3c1, 'p'],
  [0x3c5, 'u'],
  [0x3c7, 'x'],
  [0x3c4, 't'],
  [0x3b7, 'n'],
  [0x3c9, 'w'],
  [0x3b3, 'y'],
  // Latin uzantı benzerleri
  [0x251, 'a'],
  [0x261, 'g'],
  [0x1d00, 'A'],
  [0x1d0f, 'O'],
  [0x1d1c, 'U'],
]);

/** Ayraç benzerleri: çizgi/eksi türleri -> '-', orta nokta/ideografik nokta -> '.'. */
const SEPARATORS: ReadonlyMap<number, string> = new Map<number, string>([
  [0x2010, '-'],
  [0x2011, '-'],
  [0x2012, '-'],
  [0x2013, '-'],
  [0x2014, '-'],
  [0x2015, '-'],
  [0x2212, '-'],
  [0xfe58, '-'],
  [0xfe63, '-'],
  [0x058a, '-'],
  [0x00b7, '.'],
  [0x2022, '.'],
  [0x2219, '.'],
  [0x22c5, '.'],
  [0x2024, '.'],
  [0x3002, '.'],
  [0xff61, '.'],
  [0x2027, '.'],
]);

/** Sözcük içinde Latin/rakam bağlamı sayılan karakter (homoglif katlamasını tetikler). */
const LATIN_OR_DIGIT = /[A-Za-z0-9À-ɏ]/u;
const CONFUSABLE_RANGE = /[Ͱ-ϿЀ-ԯɐ-ʯᴀ-ᴯ]/u;
const RUN = /[\p{L}\p{M}\p{N}­​-‍⁠﻿]+/gu;

const cache = new Map<number, string>();
const CACHE_LIMIT = 4096;

function digitValue(cp: number): number {
  let zero = cp;
  let steps = 0;
  while (steps < 60 && /^\p{Nd}$/u.test(String.fromCodePoint(zero - 1))) {
    zero -= 1;
    steps += 1;
  }
  return (cp - zero) % 10;
}

/** Tek kod noktası için NFKC + rakam + ayraç katlaması (homoglif hariç; bağlama bağlıdır). */
export function compatBase(cp: number): string {
  if (cp < 0x80) return String.fromCharCode(cp);
  const hit = cache.get(cp);
  if (hit !== undefined) return hit;
  const ch = String.fromCodePoint(cp);
  let out: string;
  const sep = SEPARATORS.get(cp);
  if (sep !== undefined) {
    out = sep;
  } else {
    const nfkc = ch.normalize('NFKC');
    if (nfkc === ch && /^\p{Nd}$/u.test(ch)) {
      out = String(digitValue(cp));
    } else {
      out = nfkc;
    }
  }
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(cp, out);
  return out;
}

export function homoglyphOf(cp: number): string | undefined {
  return HOMOGLYPHS.get(cp);
}

/**
 * Homoglif katlamasının geçerli olduğu konumlar (UTF-16 birimi başına 1 bayt). Yalnız Latin harf veya rakam
 * içeren sözcüklerde (karışık yazı). Kiril/Yunan karakter yoksa null (hızlı yol).
 */
export function confusableMask(src: string): Uint8Array | null {
  if (!CONFUSABLE_RANGE.test(src)) return null;
  let mask: Uint8Array | null = null;
  for (const m of src.matchAll(RUN)) {
    const run = m[0];
    if (!LATIN_OR_DIGIT.test(run)) continue;
    // NFKC'nin Latin'e çevirdiği (tam genişlik vb.) karakterler de bağlam sayılır: ek kontrol gerekmez,
    // çünkü tam genişlik harf zaten Latin'e katlanır ve homoglif kümesi ayrıca denenir.
    mask ??= new Uint8Array(src.length);
    mask.fill(1, m.index, m.index + run.length);
  }
  return mask;
}

/** Bir dizgiyi tarama görünümüne katlar (kimlik üretimi için; uzunluk korunmaz). */
export function foldCompatString(s: string): string {
  let ascii = true;
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) >= 0x80) {
      ascii = false;
      break;
    }
  }
  if (ascii) return s;
  const mixed = confusableMask(s);
  let out = '';
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) ?? 0;
    const width = cp > 0xffff ? 2 : 1;
    const h = mixed && mixed[i] === 1 ? homoglyphOf(cp) : undefined;
    out += h ?? compatBase(cp);
    i += width;
  }
  return out;
}

const AT_WORD = /[[({<]\s{0,2}[aA][tT]\s{0,2}[\])}>]/gu;
const DOT_WORD = /[[({<]\s{0,2}[dD][oO][tT]\s{0,2}[\])}>]/gu;
const AT_FREE = /(?<=[\p{L}\p{N}._%+-]{1,64}) {1,2}[aA][tT] {1,2}(?=[\p{L}\p{N}-])/gu;
const DOT_FREE = / {1,2}[dD][oO][tT] {1,2}/gu;

/** `ad[at]alan[dot]uzanti` biçimini `ad@alan.uzanti` yapar (e-posta kimliği için). */
export function deobfuscateEmail(s: string): string {
  return s
    .replace(AT_WORD, '@')
    .replace(DOT_WORD, '.')
    .replace(/ {1,2}@ {1,2}/gu, '@')
    .replace(AT_FREE, '@')
    .replace(DOT_FREE, '.');
}
