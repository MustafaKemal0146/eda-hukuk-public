// Tohumlu üreteç (mulberry32): özellik testleri belirlenimci döngüyle koşar (011'de özellik testi
// kütüphanesi seçilmedi; P14a.6). Aynı tohum aynı diziyi üretir.

export type Rng = {
  next: () => number;
  int: (min: number, max: number) => number;
  pick: <T>(xs: readonly T[]) => T;
};

export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
  return { next, int, pick };
}

/** Türkçe karakter, büyük harf, tipografik işaret, kontrol ve kısaltma içeren rastgele metin. */
const ALPHABET = [
  ...'abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ0123456789',
  ' ',
  ' ',
  ' ',
  '\n',
  '\t',
  '.',
  ',',
  '/',
  '-',
  '–',
  '’',
  '“',
  '”',
  'â',
  'Â',
  'î',
  'û',
  '\u200b',
  '\u00ad',
  'md.',
  'S.K.',
  'm.',
  ' / ',
];

export function randomText(rng: Rng, maxLen: number): string {
  const n = rng.int(0, maxLen);
  let s = '';
  for (let i = 0; i < n; i++) s += rng.pick(ALPHABET);
  return s;
}
