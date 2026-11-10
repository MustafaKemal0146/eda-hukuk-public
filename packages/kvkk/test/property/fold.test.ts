// @tk TK-08
// KK-P08-3 (KK-026-3): ön işleme değişmezleri — foldChars uzunluk korur (özellik testi, tohumlu
// PRNG), ofset haritası gidiş-dönüş, NFD ve İ/ı eşdeğerliği.
import { describe, expect, it } from 'vitest';
import { foldChars, trLower, trTitle, trUpper } from '../../src/fold.ts';
import { buildScan, normalizeText, scanToNfc, toRawRange } from '../../src/normalize.ts';
import { mulberry32 } from '../../src/testing.ts';
import { AHMET, dictOf, maskedText } from '../support/helpers.ts';

const ALPHABET = [
  ...'abcçdefgğhıijklmnoöprsştuüvyzABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZâîûÂÎÛ0123456789',
  ' ',
  '\t',
  '\n',
  '\u00A0',
  '\u2009',
  '\u3000',
  '\u200B',
  '\u00AD',
  '\u2019',
  '\u2018',
  '\u00B4',
  '`',
  '.',
  ',',
  'é',
  'ß',
  'Ж',
  'ж',
  'Ω',
  '😀',
  'ç',
  'ş',
  'ğ',
  'İ',
  'ö',
];

function randomText(rnd: () => number, n: number): string {
  let s = '';
  for (let i = 0; i < n; i += 1) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  return s;
}

describe('KK-P08-3: ön işleme (026 §2)', () => {
  it('KK-P08-3 foldChars uzunluk korur (5.000 rastgele dize)', () => {
    const rnd = mulberry32(3);
    for (let i = 0; i < 5000; i += 1) {
      const s = randomText(rnd, 1 + Math.floor(rnd() * 60));
      expect(foldChars(s).length).toBe(s.length);
      expect(trLower(s).length).toBe(s.length);
      expect(trUpper(s).length).toBe(s.length);
    }
  });

  it('KK-P08-3 Türkçe tablo: İ->i, I->ı->i; aksan ve tırnak katlama', () => {
    expect(foldChars('İSTANBUL')).toBe('istanbul');
    expect(foldChars('ISMAIL')).toBe(foldChars('İsmail'));
    expect(foldChars('ÇĞÖŞÜ çğıöşü âîû')).toBe('cgosu cgiosu aiu');
    expect(foldChars('Yılmaz’ın')).toBe("yilmaz'in");
    expect(trLower('Iİ')).toBe('ıi');
    expect(trUpper('iı')).toBe('İI');
    expect(trTitle('AHMET YILMAZ')).toBe('Ahmet Yılmaz');
    expect(foldChars('a\u00A0b\u3000c')).toBe('a b c');
  });

  it('KK-P08-3 ofset haritası gidiş-dönüş (NFD girdisi)', () => {
    const rnd = mulberry32(7);
    for (let i = 0; i < 2000; i += 1) {
      const raw = randomText(rnd, 1 + Math.floor(rnd() * 40));
      const n = normalizeText(raw);
      expect(n.orig).toBe(raw.normalize('NFC'));
      expect(n.fold.length).toBe(n.orig.length);
      // Her NFC aralığı ham aralığa döner; ham dilimin NFC'si NFC dilimini içerir.
      const a = Math.floor(rnd() * (n.orig.length + 1));
      const b = a + Math.floor(rnd() * (n.orig.length - a + 1));
      const [ra, rb] = toRawRange(n, a, b);
      expect(ra).toBeLessThanOrEqual(rb);
      expect(raw.slice(ra, rb).normalize('NFC')).toContain(n.orig.slice(a, b));
    }
  });

  it('KK-P08-3 tarama akışı: sıfır genişlik atlanır, boşluk dizisi tek sembol, NFC ofsete döner', () => {
    const n = normalizeText('Ah\u200Bmet   Yıl\u00ADmaz\nson');
    const s = buildScan(n);
    expect(s.fold).toBe('ahmet yilmaz son');
    expect(s.orig).toBe('Ahmet Yılmaz\nson');
    const at = s.fold.indexOf('yilmaz');
    const [a, b] = scanToNfc(s, 0, at + 6);
    expect(n.orig.slice(a, b)).toBe('Ah\u200Bmet   Yıl\u00ADmaz');
  });

  it('KK-P08-3 NFD ve sıfır genişlikli yazımda aynı eşleşme', () => {
    const d = dictOf(AHMET);
    const nfc = maskedText('Müvekkil Ahmet Yılmaz geldi.', d);
    const nfd = maskedText('Müvekkil Ahmet Yılmaz geldi.'.normalize('NFD'), d);
    const zw = maskedText('Müvekkil Ah\u200Bmet Yıl\u200Dmaz geldi.', d);
    expect(nfd).toBe(nfc);
    expect(zw).toBe(nfc);
    expect(maskedText('Müvekkil AHMET YILMAZ geldi.', d)).toBe(nfc);
    expect(maskedText('Müvekkil Ahmet   Yılmaz geldi.', d)).toBe(nfc);
  });
});
