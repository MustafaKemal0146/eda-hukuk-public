// Türkçe metin normalizasyonu (023 §2.1, 9 adım; 025 §5.1). Tek uygulama: `tr_normalize` ofset haritalı
// sürümün çıktısıdır (ikinci kopya yazılmaz). `map[i]` = `norm[i]`'nin özgün metindeki kod birimi ofseti.
// Saf işlev; `toLocaleLowerCase` kullanılmaz (Y-104).

export type Normalized = { norm: string; map: number[] };

/** Desenle eşleşen dilimleri değiştirir; yeni karakterler eşleşmenin ilk ofsetine bağlanır. */
function replaceMapped(
  src: Normalized,
  re: RegExp,
  replacer: (m: RegExpExecArray) => string,
): Normalized {
  let norm = '';
  const map: number[] = [];
  let last = 0;
  re.lastIndex = 0;
  for (let m = re.exec(src.norm); m !== null; m = re.exec(src.norm)) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    norm += src.norm.slice(last, m.index);
    for (let i = last; i < m.index; i++) map.push(src.map[i] ?? 0);
    const rep = replacer(m);
    const origin = src.map[m.index] ?? 0;
    // Uzunluk korunuyorsa birebir eşleme; değilse hepsi eşleşmenin başına.
    for (let i = 0; i < rep.length; i++) {
      map.push(rep.length === m[0].length ? (src.map[m.index + i] ?? origin) : origin);
    }
    norm += rep;
    last = m.index + m[0].length;
  }
  norm += src.norm.slice(last);
  for (let i = last; i < src.norm.length; i++) map.push(src.map[i] ?? 0);
  return { norm, map };
}

const TR_LOWER: Readonly<Record<string, string>> = { İ: 'i', I: 'ı' };
const CIRCUMFLEX: Readonly<Record<string, string>> = { â: 'a', î: 'i', û: 'u' };
const FOLD: Readonly<Record<string, string>> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
};

function lowerChar(ch: string): string {
  const tr = TR_LOWER[ch];
  if (tr !== undefined) return tr;
  const low = ch.toLowerCase();
  // Uzunluğu değiştiren nadir eşlemeler (ör. birleşik işaretli harfler) olduğu gibi kalır.
  return low.length === ch.length ? low : ch;
}

export function normalizeWithMap(text: string): Normalized {
  let s: Normalized = { norm: text, map: Array.from({ length: text.length }, (_, i) => i) };
  // 1. NFC: yalnız birleşik işaret içeren kümeler değişir.
  s = replaceMapped(s, /\P{M}\p{M}+/gu, (m) => m[0].normalize('NFC'));
  // 2. Kontrol, sıfır genişlikli karakterler ve yumuşak tire silinir; sekme boşluk olur.
  //    Satır sonu 3. adım için korunur, sonra boşluğa çevrilir.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 023 §2.1-2 kontrol karakterlerini siler.
  s = replaceMapped(s, /[\u0000-\u0008\u000B-\u001F\u200B-\u200D\uFEFF\u00AD]/gu, () => '');
  s = replaceMapped(s, /\t/g, () => ' ');
  // 3. Satır sonu tirelemesi: "hü-\nküm" → "hüküm" (OCR).
  s = replaceMapped(s, /-[ ]*\n[ ]*(?=\p{Ll})/gu, () => '');
  s = replaceMapped(s, /\n/g, () => ' ');
  // 4. Tipografik işaretler.
  s = replaceMapped(s, /[’‘‚´`]/g, () => "'");
  s = replaceMapped(s, /[“”„«»]/g, () => '"');
  s = replaceMapped(s, /[–—−]/g, () => '-');
  // 5. Türkçe küçük harf (İ → i, I → ı; sonra yerelden bağımsız küçültme).
  s = replaceMapped(s, /\p{Lu}|\p{Lt}/gu, (m) => lowerChar(m[0]));
  // 6. Şapkalı ünlüler katlanır.
  s = replaceMapped(s, /[âîû]/g, (m) => CIRCUMFLEX[m[0]] ?? m[0]);
  // 7. Rakam arası eğik çizgi boşlukları.
  s = replaceMapped(s, /(?<=\d) *\/ *(?=\d)/g, () => '/');
  // 8. Hukuk kısaltma standardı.
  s = replaceMapped(s, /(?<!\p{L})(?:mdd|mad|md)\.(?=\s*\d|\s|$)/gu, () => 'm.');
  s = replaceMapped(s, /(?<!\p{L})m\.(?=\d)/gu, () => 'm. ');
  s = replaceMapped(s, /(?<!\p{L})(?:s\. ?k\.|sayılı k\.)(?!\p{L})/gu, () => 'sayılı kanun');
  // 9. Boşluk dizileri tek boşluk; baş/son kırpılır.
  s = replaceMapped(s, /\s{2,}/gu, () => ' ');
  s = replaceMapped(s, /^\s+|\s+$/gu, () => '');
  return s;
}

/** 023 §2.1. İdempotenttir. */
export function tr_normalize(text: string): string {
  return normalizeWithMap(text).norm;
}

/** 023 §2.2: normalize + `çğıöşü → cgiosu` (DB `translate` ile eşit). */
export function tr_fold(text: string): string {
  return tr_normalize(text).replace(/[çğıöşü]/g, (c) => FOLD[c] ?? c);
}

/** Türkçe büyük harf (i → İ, ı → I); madde harfi gibi kısa kimlikler için. */
export function tr_upper(text: string): string {
  return text.replace(/[iı]/g, (c) => (c === 'i' ? 'İ' : 'I')).toUpperCase();
}
