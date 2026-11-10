// @tk TK-08
// KK-P08-2 (KK-026-2): sağlama vektörleri ve telefon kabul/ret örnekleri.
import { describe, expect, it } from 'vitest';
import { ibanFromParts, isValidIban } from '../../src/checksums/iban.ts';
import { isValidPhone } from '../../src/checksums/phone.ts';
import { isValidTckn, tcknFromPrefix } from '../../src/checksums/tckn.ts';
import { isValidVkn, vknFromPrefix } from '../../src/checksums/vkn.ts';
import { detectPii } from '../../src/detect.ts';
import { maskedText } from '../support/helpers.ts';

describe('KK-P08-2: sağlama vektörleri (026 §6.2)', () => {
  it('KK-P08-2 TCKN 10000000146 geçerli; bozuk haneler geçersiz', () => {
    expect(isValidTckn('10000000146')).toBe(true);
    expect(isValidTckn('10000000147')).toBe(false);
    expect(isValidTckn('00000000146')).toBe(false);
    expect(isValidTckn('1000000014')).toBe(false);
    expect(tcknFromPrefix('100000001')).toBe('10000000146');
  });

  it('KK-P08-2 VKN 1234567890 geçerli, 1234567891 geçersiz', () => {
    expect(isValidVkn('1234567890')).toBe(true);
    expect(isValidVkn('1234567891')).toBe(false);
    expect(vknFromPrefix('123456789')).toBe('1234567890');
  });

  it('KK-P08-2 IBAN TR330006100519786457841326 geçerli (boşluklu/tireli de)', () => {
    expect(isValidIban('TR330006100519786457841326')).toBe(true);
    expect(isValidIban('TR33 0006 1005 1978 6457 8413 26')).toBe(true);
    expect(isValidIban('tr33-0006-1005-1978-6457-8413-26')).toBe(true);
    expect(isValidIban('TR330006100519786457841327')).toBe(false);
    const synthetic = ibanFromParts('99999', '00000000000000001');
    expect(isValidIban(synthetic)).toBe(true);
  });

  it('KK-P08-2 isValidPhone ulusal 10 hane, 2xx-5xx', () => {
    expect(isValidPhone('5321234567')).toBe(true);
    expect(isValidPhone('2124443322')).toBe(true);
    expect(isValidPhone('8501234567')).toBe(false);
    expect(isValidPhone('532123456')).toBe(false);
  });
});

const ACCEPT = [
  '+90 532 123 45 67',
  '0532 123 45 67',
  '(0212) 444 33 22',
  '532 123 45 67',
  '5321234567',
  '0 (532) 123-45-67',
  '+90(532)1234567',
];
const REJECT = ['1.250.000,00', '2024 118 12 34', '444 33 22', '0850 123 45 67'];

describe('KK-P08-2 KK-P08-9: telefon biçimleri (026 §6.3 tablo)', () => {
  for (const t of ACCEPT) {
    it(`KK-P08-2 kabul: ${t}`, () => {
      const d = detectPii(`Tel: ${t} ile arayın.`, { level: 'standard' });
      expect(d.map((x) => x.tip)).toEqual(['TEL']);
      expect(maskedText(`Tel: ${t} ile arayın.`)).toMatch(
        /^Tel: \[TEL_[A-Z2-7]{4}\] ile arayın\.$/u,
      );
    });
  }
  for (const t of REJECT) {
    it(`KK-P08-2 ret: ${t}`, () => {
      expect(
        detectPii(`Tutar ${t} olarak yazıldı.`, { level: 'standard' }).filter(
          (x) => x.tip === 'TEL',
        ),
      ).toEqual([]);
    });
  }
  it('KK-P08-2 11 haneli geçerli TCKN içindeki 10 haneli dilim telefon sayılmaz', () => {
    const d = detectPii('Kimlik 10000000146 kayıtlı.', { level: 'standard' });
    expect(d.map((x) => x.tip)).toEqual(['TCKN']);
  });
});
