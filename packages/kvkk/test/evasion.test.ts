// @tk TK-08
// KK-026-27 (KK-026-3, KK-026-9, KK-026-16 genişletmesi): tarama görünümü; biçim/yazım kaçırmaları
// (tam genişlik, Unicode rakam, ayraç, sıfır genişlikli karakter, homoglif, küçük harf, e-posta
// gizleme) ARTIK maskelenir; masum metinde yanlış pozitif yok; özgün metin bozulmaz.
import { describe, expect, it } from 'vitest';
import { detectPii, piiDetected } from '../src/detect.ts';
import type { Tip } from '../src/types.ts';
import { unmaskText } from '../src/unmask/stream.ts';
import { verifyMasked } from '../src/verify.ts';
import { dictOf, maskedText, maskOne } from './support/helpers.ts';

const TCKN = '10000000146';
const MAIL = 'ahmet.deneme@example.test';

function tipsOf(text: string): Tip[] {
  return detectPii(text, { level: 'strict', dictionary: null }).map((d) => d.tip);
}

const MUST: [string, string, Tip][] = [
  ['TCKN boşluklu', 'TC: 100 000 001 46 numaralı', 'TCKN'],
  ['TCKN tireli', 'TC: 100-000-001-46 numaralı', 'TCKN'],
  ['TCKN noktalı', 'TC: 100.000.001.46 numaralı', 'TCKN'],
  ['TCKN tam genişlik', 'TC: １０００００００１４６ numaralı', 'TCKN'],
  ['TCKN Arapça-Hint', 'TC: ١٠٠٠٠٠٠٠١٤٦ numaralı', 'TCKN'],
  ['TCKN Doğu Arap', 'TC: ۱۰۰۰۰۰۰۰۱۴۶ numaralı', 'TCKN'],
  ['TCKN matematiksel rakam', 'TC: 𝟏𝟎𝟎𝟎𝟎𝟎𝟎𝟎𝟏𝟒𝟔 numaralı', 'TCKN'],
  ['TCKN ZWSP bölünmüş', 'TC: 10000​000146 numaralı', 'TCKN'],
  ['TCKN ZWNJ bölünmüş', 'TC: 1000‌0000146 numaralı', 'TCKN'],
  ['TCKN ZWJ bölünmüş', 'TC: 100‍00000146 numaralı', 'TCKN'],
  ['TCKN WJ bölünmüş', 'TC: 1000000⁠01 46 numaralı'.replace('01 46', '0146'), 'TCKN'],
  ['TCKN BOM bölünmüş', 'TC: 1000﻿0000146 numaralı', 'TCKN'],
  ['TCKN yumuşak tire', 'TC: 1000­0000146 numaralı', 'TCKN'],
  ['TCKN LRM', 'TC: 1000‎0000146 numaralı', 'TCKN'],
  ['TCKN NBSP ayraç', 'TC: 100 000 001 46 numaralı', 'TCKN'],
  ['TCKN tam genişlik boşluklu', 'TC: １００　０００　００１　４６', 'TCKN'],
  ['TEL tam genişlik', '０５３２ １１１ ２２ ３３ arayın', 'TEL'],
  ['TEL parantezli', '+90 (532) 111 22 33 arayın', 'TEL'],
  ['TEL noktalı', '0532.111.22.33 arayın', 'TEL'],
  ['TEL tireli', '0532-111-22-33 arayın', 'TEL'],
  ['TEL eğik çizgi', '0532/111 22 33 arayın', 'TEL'],
  ['TEL uzun tire', '0532–111–22–33 arayın', 'TEL'],
  ['TEL Arapça-Hint', '٠٥٣٢ ١١١ ٢٢ ٣٣ arayın', 'TEL'],
  ['TEL ZWSP', '0532 111​22 33 arayın', 'TEL'],
  ['TEL 0090', '0090 532 111 22 33 arayın', 'TEL'],
  ['TEL NBSP', '0532 111 22 33 arayın', 'TEL'],
  ['EPOSTA tam genişlik @', 'yaz: ahmet.deneme＠example.test', 'EPOSTA'],
  ['EPOSTA tam genişlik hepsi', 'yaz: ａｈｍｅｔ.ｄｅｎｅｍｅ＠ｅｘａｍｐｌｅ.ｔｅｓｔ', 'EPOSTA'],
  ['EPOSTA [at]', 'yaz: ahmet.deneme[at]example.test', 'EPOSTA'],
  ['EPOSTA (at)', 'yaz: ahmet.deneme(at)example.test', 'EPOSTA'],
  ['EPOSTA [at] boşluklu', 'yaz: ahmet.deneme [at] example.test', 'EPOSTA'],
  ['EPOSTA [at] [dot]', 'yaz: ahmet.deneme [at] example [dot] test', 'EPOSTA'],
  ['EPOSTA (dot)', 'yaz: ahmet.deneme(at)example(dot)test', 'EPOSTA'],
  ['EPOSTA {at}', 'yaz: ahmet.deneme{at}example.test', 'EPOSTA'],
  ['EPOSTA büyük AT', 'yaz: ahmet.deneme [AT] example.test', 'EPOSTA'],
  ['EPOSTA " at "', 'yaz: ahmet.deneme at example.test', 'EPOSTA'],
  ['EPOSTA boşluklu @', 'yaz: ahmet.deneme @ example.test', 'EPOSTA'],
  ['EPOSTA ZWSP', 'yaz: ahmet.de​neme@exam​ple.test', 'EPOSTA'],
  ['EPOSTA Kiril a', 'yaz: ahmet.deneme@exаmple.test', 'EPOSTA'],
  ['EPOSTA ideografik nokta', 'yaz: ahmet.deneme@example。test', 'EPOSTA'],
  ['IBAN boşluklu', 'TR33 0006 1005 1978 6457 8413 26', 'IBAN'],
  ['IBAN tireli', 'TR33-0006-1005-1978-6457-8413-26', 'IBAN'],
  ['IBAN noktalı', 'TR33.0006.1005.1978.6457.8413.26', 'IBAN'],
  ['IBAN tam genişlik', 'ＴＲ３３ ０００６ １００５ １９７８ ６４５７ ８４１３ ２６', 'IBAN'],
  ['IBAN TR ardından boşluk', 'TR 33 0006 1005 1978 6457 8413 26', 'IBAN'],
  ['IBAN ZWSP', 'TR33 0006​1005 1978 6457 8413 26', 'IBAN'],
  ['IBAN küçük harf', 'tr330006100519786457841326', 'IBAN'],
  ['VKN ayraçlı bağlamla', 'Vergi no: 123 456 78 90 kayıtlı', 'VKN'],
  ['KISI Kiril A', 'Müvekkil Аhmet Yılmaz geldi', 'KISI'],
  ['KISI Kiril çoklu', 'Müvekkil Ahmеt Yılmаz geldi', 'KISI'],
  ['KISI Yunan', 'Müvekkil Αhmet Υılmaz geldi', 'KISI'],
  ['KISI küçük harf', 'ahmet yılmaz ile görüştüm', 'KISI'],
  ['KISI büyük harf', 'AHMET YILMAZ ile görüştüm', 'KISI'],
  ['KISI tam genişlik', 'Müvekkil Ａhmet Ｙılmaz geldi', 'KISI'],
  ['KISI ZWSP', 'Müvekkil Ah​met Yıl­maz geldi', 'KISI'],
  ['KISI karışık küçük', 'görüşme: ahmet Yılmaz ve diğerleri', 'KISI'],
  ['KISI i/İ', 'ahmet yilmaz ile görüştüm', 'KISI'],
];

describe('KK-026-27: tarama görünümü, kaçırma biçimleri artık yakalanır', () => {
  for (const [name, text, tip] of MUST) {
    it(`KK-026-27 detectPii yakalar: ${name}`, () => {
      expect(tipsOf(text)).toContain(tip);
    });
    it(`KK-026-27 mask() maskeler, özgün değer çıkmaz: ${name}`, () => {
      const out = maskedText(text);
      expect(out).toMatch(new RegExp(`\\[${tip}_[A-Z2-7]{4}\\]`, 'u'));
    });
  }
});

describe('KK-026-27: özgün metin bozulmaz, geri çözme bayt eşit', () => {
  it('KK-026-27 maskeleme yalnız eşleşen özgün aralığı değiştirir', () => {
    const before = 'Önce  ';
    const after = ' sonra';
    const raw = `${before}１００ ０００ ００１ ４６${after}`;
    const out = maskedText(raw);
    expect(out.startsWith(before)).toBe(true);
    expect(out.endsWith(after)).toBe(true);
    expect(out).toMatch(/^Önce {2}\[TCKN_[A-Z2-7]{4}\] sonra$/u);
  });

  it('KK-026-27 unmaskText kaçırma biçimini özgün yazımıyla geri koyar (bayt eşit)', () => {
    const samples = [
      'TC: 100 000 001 46 numaralı',
      'TC: １０００００００１４６ numaralı',
      'yaz: ahmet.deneme [at] example [dot] test sonra',
      'Müvekkil Аhmet Yılmaz geldi',
      'ahmet yılmaz ile görüştüm',
      '０５３２ １１１ ２２ ３３ arayın',
      'TR33.0006.1005.1978.6457.8413.26 hesabı',
      'Ah​met Yıl­maz ve TC 1000‌0000146',
    ];
    for (const text of samples) {
      const r = maskOne(text);
      const masked = r.segments[0]?.text ?? '';
      expect(masked).not.toBe(text);
      expect(unmaskText(masked, r.table)).toBe(text);
    }
  });

  it('KK-026-27 aynı değerin farklı yazımı aynı belirteci verir', () => {
    const tok = (t: string): string => /\[TCKN_[A-Z2-7]{4}\]/u.exec(maskedText(t))?.[0] ?? '';
    const base = tok(`TC ${TCKN}`);
    expect(base).not.toBe('');
    for (const v of [
      'TC 100 000 001 46',
      'TC 100-000-001-46',
      'TC １０００００００１４６',
      'TC ١٠٠٠٠٠٠٠١٤٦',
      'TC 1000​0000146',
    ]) {
      expect(tok(v)).toBe(base);
    }
    const mail = (t: string): string => /\[EPOSTA_[A-Z2-7]{4}\]/u.exec(maskedText(t))?.[0] ?? '';
    const m0 = mail(`yaz ${MAIL}`);
    expect(m0).not.toBe('');
    for (const v of [
      'yaz ahmet.deneme[at]example.test',
      'yaz ahmet.deneme (at) example (dot) test',
      'yaz AHMET.DENEME＠EXAMPLE.TEST',
    ]) {
      expect(mail(v)).toBe(m0);
    }
  });

  it('KK-026-27 sözlükli sohbette de homoglif ve ayraçlı biçimler maskelenir', () => {
    const d = dictOf({
      clients: [
        {
          id: 'c1',
          kind: 'person',
          firstName: 'Ahmet',
          lastName: 'Yılmaz',
          tckn: TCKN,
        },
      ],
    });
    const out = maskedText('Аhmet Yılmaz TC 100 000 001 46', d);
    expect(out).not.toMatch(/hmet|Yılmaz|100/u);
  });
});

describe('KK-026-27: yanlış pozitifler (masum metin maskelenmez)', () => {
  const INNOCENT: [string, string][] = [
    ['sıradan 11 haneli sayı', 'Sipariş numarası 12345678901 olarak kaydedildi'],
    ['sıradan 11 haneli sayı boşluklu', 'Kod 123 456 789 01 geçersizdir'],
    ['tarih ve saat', 'Duruşma 17.10.2026 saat 14:30 itibarıyla 09.45 de başladı'],
    ['para tutarı', 'Bedel 1.250.000,00 TL ve 12.500,75 TL ile 3 500 TL'],
    ['telefon benzeri kısa', 'Madde 12 fıkra 3 bent 4, 2024/118 E. sayılı dosya'],
    ['at kelimesi', 'Arabayı at ve bu at çok hızlı; at arabası da var'],
    ['at kelimesi iki yan', 'Toplantı at 5 ile at 9 arasında yapıldı'],
    ['saat 5 at', 'Bugün saat 5 at ve 6 civarı'],
    ['dot kelimesi', 'The dot product at hand is simple'],
    ['at serbest', 'dosya at ofis.com sitesine gitti'.replace('dosya', 'dosyaya')],
    ['normal Kiril metin', 'Привет, как дела? Это обычный русский текст без имён Ахмет'],
    ['normal Yunan metin', 'Καλημέρα κόσμε, αυτό είναι απλό κείμενο'],
    ['masum küçük harf cümle', 'ali okula gitti ve can eve geldi'],
    ['adsız kelimeler', 'ahmet geldi ve ayşe gitti'],
    ['ad tek başına', 'ahmet ile ayşe bugün toplantıdaydı'],
    ['ad ve fiil', 'mehmet yaptı'],
    ['tire ve nokta dizileri', '12-34-56-78-90 / 1.2.3.4.5.6.7.8.9.10.11'],
    ['sürüm numarası', 'sürüm 10.0.19045.5011 ve 192.168.100.200'],
  ];
  for (const [name, text] of INNOCENT) {
    it(`KK-026-27 maskelenmez: ${name}`, () => {
      expect(maskedText(text)).toBe(text);
      expect(piiDetected(text, { level: 'strict' })).toBe(false);
    });
  }
});

describe('KK-026-27: egress bekçisi (verifyMasked) kaçırma biçimlerini görür', () => {
  const LEAKS: string[] = [
    'TC 100 000 001 46',
    'TC １０００００００１４６',
    'TC 1000​0000146',
    '０５３２ １１１ ２２ ３３',
    'ahmet.deneme[at]example.test',
    'ahmet.deneme＠example.test',
    'ahmet.deneme at example.test',
    'TR33 0006 1005 1978 6457 8413 26',
    'TR33.0006.1005.1978.6457.8413.26',
  ];
  for (const leak of LEAKS) {
    it(`KK-026-27 verifyMasked kaçağı yakalar: ${JSON.stringify(leak).slice(0, 40)}`, () => {
      const r = maskOne('merhaba');
      const seg = r.segments[0];
      if (!seg) throw new Error('segment yok');
      seg.text = `merhaba ${leak} dünya`;
      const v = verifyMasked(r, null);
      expect(v.ok).toBe(false);
      expect(v.hits.some((h) => h.kind === 'surface')).toBe(true);
      expect(JSON.stringify(v)).not.toContain('100');
    });
  }

  it('KK-026-27 verifyMasked temiz çıktıyı geçirir, sözlükle homoglif sızıntısını yakalar', () => {
    const d = dictOf({
      clients: [{ id: 'c1', kind: 'person', firstName: 'Ahmet', lastName: 'Yılmaz' }],
    });
    const r = maskOne('Ahmet Yılmaz ve 100 000 001 46', d);
    expect(verifyMasked(r, d).ok).toBe(true);
    const seg = r.segments[0];
    if (!seg) throw new Error('segment yok');
    seg.text = 'Аhmet Yılmaz geldi';
    expect(verifyMasked(r, d).ok).toBe(false);
  });
});

describe('KK-026-27: performans ve bellek', () => {
  it('KK-026-27 200 KB karışık metin bütçe içinde maskelenir', () => {
    const unit =
      'Müvekkil Ahmet Yılmaz (TC 100 000 001 46) ile görüştük; ahmet.deneme[at]example.test ' +
      '０５３２ １１１ ２２ ３３ numarası, Аhmet bey. Duruşma 17.10.2026 saat 14:30, bedel 1.250.000,00 TL. ';
    const text = unit.repeat(Math.ceil(200_000 / unit.length)).slice(0, 200_000);
    const t0 = performance.now();
    const r = maskOne(text);
    const ms = performance.now() - t0;
    expect(r.segments[0]?.text).toMatch(/\[TCKN_/u);
    expect(r.segments[0]?.text).not.toContain('100 000');
    expect(ms).toBeLessThan(8000);
  });

  it('KK-026-27 200 KB düz Türkçe ve 200 KB Kiril metin hızlı taranır', () => {
    const tr =
      'Davacı vekili dilekçesinde zamanaşımı def’ini ileri sürmüş ve kararın bozulmasını istemiştir. ';
    const ru = 'Привет, как дела? Это обычный текст для проверки скорости обработки данных. ';
    for (const base of [tr, ru]) {
      const text = base.repeat(Math.ceil(200_000 / base.length)).slice(0, 200_000);
      const t0 = performance.now();
      const out = maskedText(text);
      expect(performance.now() - t0).toBeLessThan(6000);
      expect(out).toBe(text);
    }
  });

  it('KK-026-27 uzun astral ve sıfır genişlikli yığın bellek patlatmaz', () => {
    const text = `${'𝟏'.repeat(20_000)} ${'​'.repeat(50_000)} ${'a'.repeat(30_000)}`;
    const t0 = performance.now();
    const r = maskOne(text);
    expect(performance.now() - t0).toBeLessThan(6000);
    expect(r.segments[0]?.text.length).toBeGreaterThan(0);
  });

  it('KK-026-27 astral rakam aralığı vekil çiftini bölmez', () => {
    const out = maskedText('TC 𝟏𝟎𝟎𝟎𝟎𝟎𝟎𝟎𝟏𝟒𝟔 son');
    expect(out).toMatch(/^TC \[TCKN_[A-Z2-7]{4}\] son$/u);
  });
});
