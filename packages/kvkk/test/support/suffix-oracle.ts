// Bağımsız ek oracle'ı (026 §13.5, 027 §4.4, KK-027-17): `src/suffix` kodunu PAYLAŞMAYAN, ünlü sınıfı x
// son ses sınıfı tablolarını doğrudan sıralayan ikinci uygulama. Tablolar elle yazılmıştır; dil uzmanı
// doğrulaması bekler (verified: false). P32'de evals/src/gen/suffix-oracle.ts'e taşınır.

/** Ünlü sınıfı: A = kalın düz (a ı), U = kalın yuvarlak (o u), E = ince düz (e i), O = ince yuvarlak (ö ü). */
type VClass = 'A' | 'U' | 'E' | 'O';
/** Son ses: V = ünlü, H = sert ünsüz (ç f h k p s ş t), S = diğer ünsüz. */
type End = 'V' | 'H' | 'S';
export type OracleMorph =
  | 'PL'
  | 'P3'
  | 'GEN'
  | 'DAT'
  | 'ACC'
  | 'LOC'
  | 'ABL'
  | 'INS'
  | 'COP'
  | 'KI';

type Row = Record<VClass, Record<End, string>>;
const row = (
  a: [string, string, string],
  u: [string, string, string],
  e: [string, string, string],
  o: [string, string, string],
): Row => ({
  A: { V: a[0], H: a[1], S: a[2] },
  U: { V: u[0], H: u[1], S: u[2] },
  E: { V: e[0], H: e[1], S: e[2] },
  O: { V: o[0], H: o[1], S: o[2] },
});

const TABLE: Record<Exclude<OracleMorph, 'KI'>, Row> = {
  PL: row(
    ['lar', 'lar', 'lar'],
    ['lar', 'lar', 'lar'],
    ['ler', 'ler', 'ler'],
    ['ler', 'ler', 'ler'],
  ),
  P3: row(['sı', 'ı', 'ı'], ['su', 'u', 'u'], ['si', 'i', 'i'], ['sü', 'ü', 'ü']),
  GEN: row(['nın', 'ın', 'ın'], ['nun', 'un', 'un'], ['nin', 'in', 'in'], ['nün', 'ün', 'ün']),
  DAT: row(['ya', 'a', 'a'], ['ya', 'a', 'a'], ['ye', 'e', 'e'], ['ye', 'e', 'e']),
  ACC: row(['yı', 'ı', 'ı'], ['yu', 'u', 'u'], ['yi', 'i', 'i'], ['yü', 'ü', 'ü']),
  LOC: row(['da', 'ta', 'da'], ['da', 'ta', 'da'], ['de', 'te', 'de'], ['de', 'te', 'de']),
  ABL: row(
    ['dan', 'tan', 'dan'],
    ['dan', 'tan', 'dan'],
    ['den', 'ten', 'den'],
    ['den', 'ten', 'den'],
  ),
  INS: row(['yla', 'la', 'la'], ['yla', 'la', 'la'], ['yle', 'le', 'le'], ['yle', 'le', 'le']),
  COP: row(
    ['dır', 'tır', 'dır'],
    ['dur', 'tur', 'dur'],
    ['dir', 'tir', 'dir'],
    ['dür', 'tür', 'dür'],
  ),
};

/** 3. kişi iyelikten sonra kaynaştırma n'li hal ekleri. */
const AFTER_P3: Partial<Record<OracleMorph, Record<VClass, string>>> = {
  GEN: { A: 'nın', U: 'nun', E: 'nin', O: 'nün' },
  DAT: { A: 'na', U: 'na', E: 'ne', O: 'ne' },
  ACC: { A: 'nı', U: 'nu', E: 'ni', O: 'nü' },
  LOC: { A: 'nda', U: 'nda', E: 'nde', O: 'nde' },
  ABL: { A: 'ndan', U: 'ndan', E: 'nden', O: 'nden' },
  INS: { A: 'yla', U: 'yla', E: 'yle', O: 'yle' },
};

const VOWEL_CLASS: Record<string, VClass> = {
  a: 'A',
  ı: 'A',
  â: 'A',
  o: 'U',
  u: 'U',
  û: 'U',
  e: 'E',
  i: 'E',
  î: 'E',
  ö: 'O',
  ü: 'O',
};
const HARD_LETTERS = 'çfhkpsşt';
const LOWER: Record<string, string> = {
  I: 'ı',
  İ: 'i',
  Ç: 'ç',
  Ğ: 'ğ',
  Ö: 'ö',
  Ş: 'ş',
  Ü: 'ü',
  Â: 'â',
  Î: 'î',
  Û: 'û',
};
const UPPER: Record<string, string> = {
  i: 'İ',
  ı: 'I',
  ç: 'Ç',
  ğ: 'Ğ',
  ö: 'Ö',
  ş: 'Ş',
  ü: 'Ü',
};
const LETTER_READING: Record<string, string> = {
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
const DIGIT_READING = [
  'sıfır',
  'bir',
  'iki',
  'üç',
  'dört',
  'beş',
  'altı',
  'yedi',
  'sekiz',
  'dokuz',
];
const FRONT_EXCEPTIONS = [
  'rol',
  'saat',
  'harf',
  'kalp',
  'alkol',
  'gol',
  'kemal',
  'celal',
  'cemal',
  'nihal',
  'hilal',
];
const FRONT: Record<VClass, VClass> = { A: 'E', U: 'O', E: 'E', O: 'O' };

function low(ch: string): string {
  if (LOWER[ch]) return LOWER[ch] as string;
  const c = ch.charCodeAt(0);
  return c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : ch;
}

function up(ch: string): string {
  if (UPPER[ch]) return UPPER[ch] as string;
  const c = ch.charCodeAt(0);
  return c >= 97 && c <= 122 ? String.fromCharCode(c - 32) : ch;
}

const isLetter = (ch: string): boolean => /\p{L}/u.test(ch);
const isUpperLetter = (ch: string): boolean => isLetter(ch) && low(ch) !== ch;

interface Sound {
  v: VClass;
  end: End;
}

function soundOf(word: string): Sound | null {
  const w = [...word].map(low).filter(isLetter);
  let v: VClass | null = null;
  for (const ch of w) if (VOWEL_CLASS[ch]) v = VOWEL_CLASS[ch] as VClass;
  const last = w[w.length - 1];
  if (v === null || last === undefined) return null;
  if (
    FRONT_EXCEPTIONS.includes(
      w
        .join('')
        .replace(
          /[çğıöşüâîû]/gu,
          (c) =>
            ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[c] ?? c,
        ),
    )
  ) {
    v = FRONT[v];
  }
  const end: End = VOWEL_CLASS[last] ? 'V' : HARD_LETTERS.includes(last) ? 'H' : 'S';
  return { v, end };
}

function stemSound(display: string, tip: string): Sound {
  const pieces = display.trim().split(/\s+/u);
  let last = pieces[pieces.length - 1] ?? '';
  while (last.length > 0 && !/[\p{L}\d.]/u.test(last.charAt(last.length - 1)))
    last = last.slice(0, -1);
  const core = last.replace(/\.+$/u, '');
  const tail = core.charAt(core.length - 1);
  if (/\d/u.test(tail)) return soundOf(DIGIT_READING[Number(tail)] as string) as Sound;
  if (tip === 'EPOSTA') {
    const runs = display.match(/\p{L}+/gu) ?? [];
    return soundOf(runs[runs.length - 1] ?? 'e') ?? { v: 'E', end: 'V' };
  }
  const letters = [...core].filter(isLetter);
  const lastLetter = letters[letters.length - 1] ?? 'E';
  const noVowel = !letters.some((c) => VOWEL_CLASS[low(c)]);
  const allUpper = letters.length >= 2 && letters.every(isUpperLetter);
  if (core.includes('.') || (allUpper && noVowel)) {
    const key = isUpperLetter(lastLetter) ? lastLetter : up(lastLetter);
    return soundOf(LETTER_READING[key] ?? 'e') ?? { v: 'E', end: 'V' };
  }
  return soundOf(core) ?? soundOf(LETTER_READING[up(lastLetter)] ?? 'e') ?? { v: 'E', end: 'V' };
}

/** Zinciri verilen ses durumuna göre kurar (oracle). */
export function oracleRealize(chain: readonly OracleMorph[], start: Sound): string {
  let s = start;
  let afterP3 = false;
  let out = '';
  for (const m of chain) {
    let piece: string;
    if (m === 'KI') piece = 'ki';
    else if (afterP3 && AFTER_P3[m]) piece = (AFTER_P3[m] as Record<VClass, string>)[s.v];
    else piece = TABLE[m][s.v][s.end];
    out += piece;
    afterP3 = m === 'P3';
    const next = soundOf(piece);
    if (next) s = next;
  }
  return out;
}

export function oracleSound(display: string, tip: string): Sound {
  return stemSound(display, tip);
}

export function oracleExpected(
  display: string,
  tip: string,
  chain: readonly OracleMorph[],
  apostrophe = "'",
): string {
  let sfx = oracleRealize(chain, stemSound(display, tip));
  const letters = [...display].filter(isLetter);
  if (letters.length >= 2 && letters.every((c) => !(isLetter(c) && up(c) !== c && low(c) === c))) {
    sfx = [...sfx].map(up).join('');
  }
  return `${display}${apostrophe}${sfx}`;
}

/** Belirsizliği olmayan zincirler (sonu P3 olan zincirler ACC ile karışır; dışarıda). */
export const ORACLE_CHAINS: readonly (readonly OracleMorph[])[] = [
  ['GEN'],
  ['DAT'],
  ['ACC'],
  ['LOC'],
  ['ABL'],
  ['INS'],
  ['COP'],
  ['PL'],
  ['LOC', 'KI'],
  ['GEN', 'KI'],
  ['PL', 'GEN'],
  ['PL', 'DAT'],
  ['PL', 'LOC'],
  ['PL', 'ABL'],
  ['PL', 'ACC'],
  ['P3', 'GEN'],
  ['P3', 'DAT'],
  ['P3', 'ACC'],
  ['P3', 'LOC'],
  ['P3', 'ABL'],
  ['P3', 'INS'],
  ['PL', 'P3', 'GEN'],
  ['PL', 'P3', 'LOC'],
  ['DAT', 'COP'],
  ['LOC', 'COP'],
];

export const DECOY_SOUNDS: readonly Sound[] = (['A', 'U', 'E', 'O'] as const).flatMap((v) =>
  (['V', 'H', 'S'] as const).map((end) => ({ v, end })),
);
