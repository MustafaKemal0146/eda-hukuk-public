// @tk TK-08
// KK-P08-5 (KK-026-6, KK-026-7): sözlük yüzeyleri, belirsiz varyant, sınır kuralı ve ek toleransı,
// canonMap, öğrenilen yüzey iki geçiş. KK-P08-14 (KK-026-23): sözlük sürümü girdiye bağlı.
import { describe, expect, it } from 'vitest';
import { compileDictionary } from '../src/dictionary/compile.ts';
import { sourcesFromInput } from '../src/dictionary/from-input.ts';
import { personSurfaces } from '../src/dictionary/variants.ts';
import { unmaskText } from '../src/unmask/stream.ts';
import { AHMET, dictOf, maskedText, maskOne, maskSegments } from './support/helpers.ts';
import { nodeCryptoPort } from './support/node-crypto-port.ts';

const TOKEN = /\[KISI_[A-Z2-7]{4}\]/u;

describe('KK-P08-5: yüzey türetimi (026 §7.2)', () => {
  it('KK-P08-5 Ahmet Yılmaz -> tüm yüzeyler', () => {
    expect(new Set(personSurfaces('Ahmet', 'Yılmaz', 4))).toEqual(
      new Set([
        'Ahmet Yılmaz',
        'Yılmaz Ahmet',
        'Yılmaz, Ahmet',
        'A. Yılmaz',
        'A.Yılmaz',
        'Yılmaz',
        'Ahmet',
      ]),
    );
  });

  it('KK-P08-5 çoklu ad ve takma ad; kısa ve LEGAL_TERMS tekilleri üretilmez', () => {
    const s = new Set(personSurfaces('Ali Can', 'Ak', 4, ['Ceza Davası']));
    expect(s.has('Ali Can Ak')).toBe(true);
    expect(s.has('Ali Ak')).toBe(true);
    expect(s.has('Ak, Ali Can')).toBe(true);
    expect(s.has('Ak')).toBe(false); // < 4 harf
    expect(s.has('Ceza')).toBe(false); // LEGAL_TERMS
  });

  it('KK-P08-5 sourcesFromInput kimlik ve görünen değer kuralları (026 §4.4, §4.7)', () => {
    const src = sourcesFromInput(
      {
        clients: [
          { id: 'c1', kind: 'person', firstName: 'Ahmet', lastName: 'Yılmaz', tckn: '10000000146' },
          { id: 'c2', kind: 'entity', entityName: 'Mavi Yapı A.Ş.' },
        ],
        parties: [
          {
            id: 'p1',
            clientId: null,
            role: 'defendant',
            kind: 'person',
            firstName: 'Ayşe',
            lastName: 'Karaduman',
            counselName: 'Av. Deniz Ateşoğlu',
          },
        ],
        cases: [{ id: 'k1', esasNo: '2024/118', officeFileCode: 'B-77' }],
      },
      { maskOwnCaseNumber: true },
    );
    const ids = src.map((s) => `${s.tip}:${s.identity}:${s.display}`);
    expect(ids).toContain('KISI:c1:Ahmet Yılmaz');
    expect(ids).toContain('TCKN:c1:tckn:10000000146');
    expect(ids).toContain('SIRKET:c2:Mavi Yapı A.Ş.');
    expect(ids).toContain('KISI:p1:Ayşe Karaduman');
    expect(ids).toContain('KISI:p1:counsel:Av. Deniz Ateşoğlu');
    expect(ids).toContain('DOSYA:k1:esas:2024/118');
    expect(ids).toContain('DOSYA:k1:kod:B-77');
    const mavi = src.find((s) => s.tip === 'SIRKET');
    expect(mavi?.surfaces).toEqual(['Mavi Yapı A.Ş.', 'Mavi Yapı']);
    expect(
      sourcesFromInput(
        { clients: [], parties: [], cases: [{ id: 'k', esasNo: '1/1' }] },
        { maskOwnCaseNumber: false },
      ),
    ).toEqual([]);
  });
});

describe('KK-P08-5: sınır kuralı ve ek toleransı (026 §7.3)', () => {
  const d = dictOf(AHMET);
  const cases: [string, string][] = [
    ["Yılmaz'ın dosyası", "'ın dosyası"],
    ['Yılmazın dosyası', 'ın dosyası'],
    ["YILMAZ'A yazıldı", "'A yazıldı"],
    ["A. Yılmaz'dan geldi", "'dan geldi"],
    ['Yılmazlar geldi', 'lar geldi'],
    ['Ahmet’in notu', '’in notu'],
  ];
  for (const [text, rest] of cases) {
    it(`KK-P08-5 ek toleransı: ${text}`, () => {
      const out = maskedText(text, d);
      expect(out).toMatch(TOKEN);
      expect(out.replace(TOKEN, '')).toBe(rest);
    });
  }

  it('KK-P08-5 kelime içi alt dizge eşleşmez', () => {
    for (const t of ['Yılmazoğlu geldi', 'Ahmetcan geldi', 'Karayılmaz geldi']) {
      expect(maskedText(t, d)).toBe(t);
    }
  });

  it('KK-P08-5 tek sözcüklü varyant şekil kuralı: küçük harfli yalnız soyad eşleşmez', () => {
    expect(maskedText('yılmaz bir sıfat olarak', d)).toBe('yılmaz bir sıfat olarak');
    expect(maskedText('ahmet yılmaz geldi', d)).toMatch(/^\[KISI_[A-Z2-7]{4}\] geldi$/u);
  });

  it('KK-P08-5 sıfır genişlikli karakter ve NFD içinde eşleşme', () => {
    expect(maskedText('Yıl\u200Bmaz geldi', d)).toMatch(/^\[KISI_[A-Z2-7]{4}\] geldi$/u);
    expect(maskedText('Yılmaz geldi'.normalize('NFD'), d)).toMatch(/^\[KISI_[A-Z2-7]{4}\] geldi$/u);
  });

  it('KK-P08-5 aynı kişinin tüm yüzeyleri aynı token', () => {
    const r = maskOne('Ahmet Yılmaz, YILMAZ, Ahmet, A. Yılmaz ve Yılmaz aynı kişidir.', d);
    expect(new Set(r.segments[0]?.spans.map((s) => s.token)).size).toBe(1);
  });
});

describe('KK-P08-5: belirsiz varyant ve canonMap', () => {
  it('KK-P08-5 ortak soyad iki kişide belirsiz: canon kimliği, yazıldığı yüzey geri döner', () => {
    const d = dictOf({
      clients: [
        { id: 'c1', kind: 'person', firstName: 'Ahmet', lastName: 'Yılmaz' },
        { id: 'c2', kind: 'person', firstName: 'Zeynep', lastName: 'Yılmaz' },
      ],
    });
    expect(d.ambiguous.has('yilmaz')).toBe(true);
    const r = maskOne('Ahmet Yılmaz ile Zeynep Yılmaz; Yılmaz imzaladı.', d);
    const tokens = r.segments[0]?.spans.map((s) => s.token) ?? [];
    expect(new Set(tokens).size).toBe(3);
    expect(unmaskText(r.segments[0]?.text ?? '', r.table)).toBe(
      'Ahmet Yılmaz ile Zeynep Yılmaz; Yılmaz imzaladı.',
    );
  });

  it('KK-P08-5 aynı TCKN/telefon farklı yazımda aynı token (canonMap)', () => {
    const d = dictOf(AHMET);
    expect(d.canonMap.get('TCKN:10000000146')).toBe('c-ahmet:tckn');
    const r = maskOne('Tel 0532 123 45 67, +90 532 1234567 ve (0532) 123-45-67.', d);
    expect(new Set(r.segments[0]?.spans.map((s) => s.token)).size).toBe(1);
    // Görünen değer kayıttaki yazım.
    expect(unmaskText(r.segments[0]?.text ?? '', r.table)).toBe(
      'Tel 0532 123 45 67, 0532 123 45 67 ve 0532 123 45 67.',
    );
  });

  it('KK-P08-14 sözlük sürümü girdiye bağlı ve aynı girdide aynı', () => {
    const a = dictOf(AHMET);
    const b = dictOf(AHMET);
    const c = dictOf({
      clients: [{ id: 'c9', kind: 'person', firstName: 'Ali', lastName: 'Veli' }],
    });
    expect(a.version).toMatch(/^[0-9a-f]{8}$/u);
    expect(a.version).toBe(b.version);
    expect(a.version).not.toBe(c.version);
    const reordered = compileDictionary(
      [
        ...sourcesFromInput({ ...AHMET, parties: [], cases: [] }, { maskOwnCaseNumber: true }),
      ].reverse(),
      { crypto: nodeCryptoPort },
    );
    expect(reordered.version).toBe(a.version);
  });
});

describe('KK-P08-5: öğrenilen yüzey iki geçiş (026 §6.7, KK-026-7)', () => {
  it('KK-P08-5 tur-1 ipuçlu ad, tur-2 ipucusuz yazımı maskeler', () => {
    const turn1 = 'Sayın Yurdagül Perşembe dilekçeyi imzaladı.';
    const turn2 = "Yurdagül Perşembe'nin dosyası hazır; Yurdagül de geldi.";
    // Yalnız tur-2 metni: ad gazetteer'da yok, ipucu yok -> sezgi maskelemez.
    expect(maskedText(turn2)).toBe(turn2);
    const r = maskSegments([
      { id: 't1', text: turn1, origin: 'user_text' },
      { id: 't2', text: turn2, origin: 'user_text' },
    ]);
    const out = r.segments[1]?.text ?? '';
    expect(out).toMatch(
      /^\[KISI_[A-Z2-7]{4}\]'nin dosyası hazır; \[KISI_[A-Z2-7]{4}\] de geldi\.$/u,
    );
    expect(r.stats.learned).toBeGreaterThanOrEqual(2);
    expect(r.segments[1]?.spans.every((s) => s.source === 'learned')).toBe(true);
    // Gün adı soyad tek başına varyant olmaz (LEGAL_TERMS ay/gün): "Perşembe günü" korunur.
    const r2 = maskSegments([
      { id: 't1', text: turn1, origin: 'user_text' },
      { id: 't3', text: 'Perşembe günü duruşma var.', origin: 'user_text' },
    ]);
    expect(r2.segments[1]?.text).toBe('Perşembe günü duruşma var.');
  });

  it('KK-P08-5 belirsiz soyad iki tam adda ortaksa sahip kimliği kullanılmaz', () => {
    const r = maskSegments([
      {
        id: 'a',
        text: 'Sayın Tanbay Ferkutlu ve Sayın Erkılıç Ferkutlu geldi.',
        origin: 'user_text',
      },
      { id: 'b', text: 'Ferkutlu imzaladı.', origin: 'user_text' },
    ]);
    const first = r.segments[0]?.spans.map((s) => s.token) ?? [];
    const lone = r.segments[1]?.spans[0]?.token;
    expect(first.length).toBe(2);
    expect(lone).toBeDefined();
    expect(first).not.toContain(lone);
    expect(unmaskText(r.segments[1]?.text ?? '', r.table)).toBe('Ferkutlu imzaladı.');
  });
});
