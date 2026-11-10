// @eda/kvkk/testing: tohumlu sentetik veri üreticisi (027 §3.3). Yalnız test, ölçüm ve wire testi
// içindir; gerçek kişi/numara üretmez: TCKN öneki 1000000, IBAN banka kodu 99999, e-posta yalnız
// example.com/example.org/*.test, soyadlar hece birleşimidir (gerçek soyad listesi yok). Sağlama
// algoritmaları tek kaynaktan (checksums/) tersine kullanılır.
import { ibanFromParts } from './checksums/iban.ts';
import { tcknFromPrefix } from './checksums/tckn.ts';
import { vknFromPrefix } from './checksums/vkn.ts';
import { GIVEN_NAMES } from './data/given-names.tr.ts';
import { trLower } from './fold.ts';

/** mulberry32 PRNG (tohumlu, deterministik). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = [
  'ka',
  'ra',
  'du',
  'te',
  'lin',
  'gö',
  'ker',
  'ba',
  'şar',
  'öz',
  'tur',
  'can',
  'el',
  'ver',
  'sün',
  'bel',
  'dir',
  'kor',
  'mu',
  'zel',
  'ya',
  'sa',
  'rı',
  'fer',
  'tü',
  'lek',
  'nar',
  'gül',
  'dem',
  'ırk',
];
const SURNAME_ENDINGS = ['oğlu', 'gil', 'er', 'an', 'soy', 'ay', 'taş', 'en', 'kut', 'baş'];
const COMPANY_CORES = [
  'Mavi',
  'Yeşil',
  'Kuzey',
  'Doğu',
  'Ege',
  'Toros',
  'Akdeniz',
  'Pınar',
  'Çınar',
  'Defne',
  'Lale',
  'Nehir',
  'Yaprak',
  'Kayın',
  'Ardıç',
  'Mercan',
  'Turkuaz',
  'Kehribar',
  'Zümrüt',
  'Safir',
];
const COMPANY_SECTORS = [
  'Yapı',
  'Gıda',
  'Tekstil',
  'Lojistik',
  'Enerji',
  'Yazılım',
  'Danışmanlık',
  'Turizm',
  'Otomotiv',
  'Ambalaj',
  'Mobilya',
  'Kimya',
  'Medikal',
  'İnşaat',
  'Tarım',
];
const COMPANY_SUFFIX_FORMS = [
  'A.Ş.',
  'Ltd. Şti.',
  'Anonim Şirketi',
  'Limited Şirketi',
  'San. ve Tic. A.Ş.',
  'San. ve Tic. Ltd. Şti.',
  'Holding',
];
const STREET_STEMS = [
  'Lale',
  'Gülpınar',
  'Karanfil',
  'Ilgın',
  'Sedir',
  'Akasya',
  'Ihlamur',
  'Kumru',
];
const DISTRICT_PROVINCE: readonly [string, string][] = [
  ['Çankaya', 'Ankara'],
  ['Kadıköy', 'İstanbul'],
  ['Bornova', 'İzmir'],
  ['Nilüfer', 'Bursa'],
  ['Seyhan', 'Adana'],
  ['Muratpaşa', 'Antalya'],
  ['Tepebaşı', 'Eskişehir'],
  ['Selçuklu', 'Konya'],
];
const MONTHS_TR = [
  'Ocak',
  'Şubat',
  'Mart',
  'Nisan',
  'Mayıs',
  'Haziran',
  'Temmuz',
  'Ağustos',
  'Eylül',
  'Ekim',
  'Kasım',
  'Aralık',
];
/** Gazetteer'da olmayan, uydurma "nadir" adlar (sezgi sınırı ölçümü için). */
const RARE_GIVEN = ['Yurdagül', 'Aksungur', 'Tanbay', 'Erkılıç', 'Gökbörü', 'Ilbay', 'Sırmagül'];

export const PHONE_FORMATS = 7;

export class SyntheticGen {
  readonly #rnd: () => number;

  constructor(seed: number) {
    this.#rnd = mulberry32(seed);
  }

  next(): number {
    return this.#rnd();
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.#rnd() * (max - min + 1));
  }

  pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(this.#rnd() * xs.length)] as T;
  }

  digits(n: number): string {
    let s = '';
    for (let i = 0; i < n; i += 1) s += String(this.int(0, 9));
    return s;
  }

  tckn(): string {
    return tcknFromPrefix(`1000000${this.digits(2)}`);
  }

  vkn(): string {
    return vknFromPrefix(`${this.int(1, 9)}${this.digits(8)}`);
  }

  iban(): string {
    return ibanFromParts('99999', `0${this.digits(16)}`);
  }

  ibanFormatted(style: 'plain' | 'spaced' | 'dashed'): string {
    const raw = this.iban();
    if (style === 'plain') return raw;
    const groups = raw.match(/.{1,4}/gu) ?? [raw];
    return groups.join(style === 'spaced' ? ' ' : '-');
  }

  /** 026 §6.3 yedi kabul biçimi. */
  phone(format?: number): { text: string; national: string } {
    const area = `5${this.int(0, 5)}${this.int(0, 9)}`;
    const a = this.digits(3);
    const b = this.digits(2);
    const c = this.digits(2);
    const national = `${area}${a}${b}${c}`;
    const f = format ?? this.int(0, PHONE_FORMATS - 1);
    const texts = [
      `+90 ${area} ${a} ${b} ${c}`,
      `0${area} ${a} ${b} ${c}`,
      `(0${area}) ${a} ${b} ${c}`,
      `${area} ${a} ${b} ${c}`,
      `${national}`,
      `0 (${area}) ${a}-${b}-${c}`,
      `+90(${area})${a}${b}${c}`,
    ];
    return { text: texts[f % texts.length] as string, national };
  }

  email(): string {
    const local = `${trAscii(trLower(this.givenName()))}.${trAscii(trLower(this.surname()))}${this.int(1, 99)}`;
    return `${local}@${this.pick(['example.com', 'example.org', 'buro.test', 'posta.test'])}`;
  }

  givenName(): string {
    return this.pick(GIVEN_NAMES);
  }

  rareGivenName(): string {
    return this.pick(RARE_GIVEN);
  }

  surname(): string {
    const n = this.int(2, 3);
    let s = '';
    for (let i = 0; i < n; i += 1) s += this.pick(SYLLABLES);
    if (this.#rnd() < 0.4) s += this.pick(SURNAME_ENDINGS);
    return capitalize(s);
  }

  company(): { name: string; core: string } {
    const core = `${this.pick(COMPANY_CORES)} ${this.pick(COMPANY_SECTORS)}`;
    return { name: `${core} ${this.pick(COMPANY_SUFFIX_FORMS)}`, core };
  }

  plate(): string {
    const il = String(this.int(1, 81)).padStart(2, '0');
    const letters = 'ABCDEFGHIJKLMNOPRSTUVYZ';
    const nLetters = this.int(1, 3);
    let l = '';
    for (let i = 0; i < nLetters; i += 1) l += letters.charAt(this.int(0, letters.length - 1));
    if (
      nLetters === 2 &&
      ['TL', 'TC', 'KG', 'KM', 'MM', 'CM', 'MB', 'GB', 'TB', 'KB', 'TV', 'EK', 'MD'].includes(l)
    ) {
      l = 'AB';
    }
    const nDigits = nLetters === 1 ? 4 : nLetters === 2 ? this.int(3, 4) : this.int(2, 3);
    return `${il} ${l} ${this.digits(nDigits)}`;
  }

  address(): string {
    const [district, province] = this.pick(DISTRICT_PROVINCE);
    const street = `${this.pick(STREET_STEMS)} Sokak`;
    const mah = `${this.pick(STREET_STEMS)}tepe Mahallesi`;
    return `${mah} ${street} No: ${this.int(1, 120)} Daire: ${this.int(1, 30)} ${district}/${province}`;
  }

  birthDate(words: boolean): string {
    const d = this.int(1, 28);
    const m = this.int(1, 12);
    const y = this.int(1950, 2005);
    if (words) return `${d} ${MONTHS_TR[m - 1]} ${y}`;
    return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
  }

  esasNo(): string {
    return `${this.int(2015, 2026)}/${this.int(1, 9999)}`;
  }
}

function capitalize(s: string): string {
  const first = s.charAt(0);
  const map: Record<string, string> = { ç: 'Ç', ğ: 'Ğ', ı: 'I', i: 'İ', ö: 'Ö', ş: 'Ş', ü: 'Ü' };
  const up =
    map[first] ??
    String.fromCharCode(first.charCodeAt(0) - (first >= 'a' && first <= 'z' ? 32 : 0));
  return up + s.slice(1);
}

function trAscii(s: string): string {
  const map: Record<string, string> = {
    ç: 'c',
    ğ: 'g',
    ı: 'i',
    ö: 'o',
    ş: 's',
    ü: 'u',
    â: 'a',
    î: 'i',
    û: 'u',
  };
  let out = '';
  for (const ch of s) out += map[ch] ?? ch;
  return out;
}
