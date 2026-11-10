// @tk TK-08
// KK-P08-9 (KK-026-17): algılayıcılar — ReDoS sınırı adım sayacıyla, zor negatifler maskelenmez
// (026 §6.6), yapısal/sezgisel örnekler. KK-026-16: detectPii/piiDetected/sensitiveTopic.
import { describe, expect, it } from 'vitest';
import { detectPii, piiDetected, sensitiveTopic } from '../src/detect.ts';
import { StepBudget } from '../src/detectors/candidate.ts';
import { detectStructural } from '../src/detectors/structural.ts';
import { KvkkMaskingError } from '../src/errors.ts';
import { DEFAULT_LIMITS } from '../src/limits.ts';
import { mask } from '../src/mask.ts';
import { buildScan, normalizeText } from '../src/normalize.ts';
import { TurnMaskTable } from '../src/tokens/table.ts';
import type { Tip } from '../src/types.ts';
import { createUnmasker } from '../src/unmask/stream.ts';
import { AHMET, dictOf, K_CONV, maskedText } from './support/helpers.ts';
import { nodeCryptoPort } from './support/node-crypto-port.ts';

const ALL: ReadonlySet<Tip> = new Set([
  'IBAN',
  'EPOSTA',
  'TCKN',
  'TEL',
  'VKN',
  'PLAKA',
  'TARIH_DOGUM',
]);

/** 026 §10.5 saldırgan girdiler (10K+). */
const ADVERSARIAL: [string, string][] = [
  ['rakam', '1'.repeat(10_000)],
  ['boşluk', ' '.repeat(10_000)],
  ['nokta', '.'.repeat(10_000)],
  ['tire', '-'.repeat(10_000)],
  ['rakam-boşluk', '1 '.repeat(6_000)],
  ['rakam-nokta', '1.'.repeat(6_000)],
  ['telefon tekrarı', '0532 123 45 6'.repeat(1_000)],
  ['e-posta yığını', 'a@'.repeat(6_000)],
  ['iç içe parantez', `${'('.repeat(6_000)}${')'.repeat(6_000)}`],
  ['TITLE dizisi', 'Ahmet Mehmet Ali '.repeat(1_000)],
  ['adres anahtarları', 'Mah. Sok. No: 1 '.repeat(1_000)],
  ['unvan ekleri', 'A.Ş. Ltd. Şti. '.repeat(1_000)],
  ['tr öneki', `TR${'1'.repeat(10_000)}`],
  ['NFD yığını', 'e\u0301'.repeat(6_000)],
  ['sıfır genişlik', `a${'\u200B'.repeat(10_000)}b`],
  ['token karışımı', '[KISI_ABCD]［KISI_ABCD]'.repeat(800)],
  ['kapanmayan çit', `\`\`\`\n${'x'.repeat(10_000)}`],
];

describe('KK-P08-9: ReDoS ve adım bütçesi (026 §10)', () => {
  for (const [name, text] of ADVERSARIAL) {
    it(`KK-P08-9 yapısal algılayıcı adım sayacı sınırlı: ${name}`, () => {
      const scan = buildScan(normalizeText(text));
      const budget = new StepBudget(DEFAULT_LIMITS.windowBudgetFactor * text.length);
      detectStructural(scan, { kinds: ALL, vknWithoutContext: true, budget });
      expect(budget.used).toBeLessThanOrEqual(DEFAULT_LIMITS.windowBudgetFactor * text.length);
    });

    it(`KK-P08-9 mask() biter veya izinli kodla reddeder: ${name}`, () => {
      try {
        const r = mask({
          segments: [{ id: 's', text, origin: 'user_text' }],
          convKey: K_CONV,
          dictionary: dictOf(AHMET),
          options: { tokenHashChars: 4, maskOwnCaseNumber: true },
          crypto: nodeCryptoPort,
        });
        expect(r.segments.length).toBe(1);
      } catch (e) {
        expect(e).toBeInstanceOf(KvkkMaskingError);
        expect(['INPUT_TOO_LARGE', 'BUDGET_EXCEEDED']).toContain((e as KvkkMaskingError).code);
      }
    });
  }

  it('KK-P08-9 1.000.000 karakter tek satır kabul; bir fazlası INPUT_TOO_LARGE', () => {
    const big = 'x'.repeat(DEFAULT_LIMITS.maskInputMaxChars);
    const run = (text: string) =>
      mask({
        segments: [{ id: 's', text, origin: 'user_text' }],
        convKey: K_CONV,
        dictionary: null,
        options: { tokenHashChars: 4, maskOwnCaseNumber: true },
        crypto: nodeCryptoPort,
      });
    expect(run(big).segments[0]?.text.length).toBe(big.length);
    expect(() => run(`${big}x`)).toThrow(KvkkMaskingError);
  });

  it('KK-P08-9 geri çözücü saldırgan girdide doğrusal (kapanmayan çit, token karışımı)', () => {
    const t = new TurnMaskTable();
    t.set('[KISI_ABCD]', { tip: 'KISI', display: 'Ahmet Yılmaz', identity: 'c1' });
    for (const [, text] of ADVERSARIAL) {
      const u = createUnmasker(t);
      const out = u.push('p', text) + u.end('p');
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

/** 026 §6.6 hukuki zor negatifler: sezgiler dahil (strict) hiçbiri algılanmaz. */
const HARD_NEGATIVES = [
  'Yargıtay 9. Hukuk Dairesi kararı bozdu.',
  'Ankara BAM 12. HD tarafından incelendi.',
  'Yargıtay Hukuk Genel Kurulu kararı.',
  'Asliye Hukuk Mahkemesi dosyası.',
  'Türk Ceza Kanunu uygulanır.',
  '6098 sayılı Kanun m. 344 uyarınca.',
  'Dosya 2021/1234 E. sayılı.',
  'Karar tarihi 12.03.2024 olup kesindir.',
  'Bedel 1.250.000,00 TL olarak belirlendi.',
  'Ocak ayında Pazartesi günü duruşma var.',
  'DAVACI : bilgiler aşağıdadır.',
  'KONU : Kira bedelinin tespiti.',
  'Kira tazminat temyiz vekalet kavramları.',
  'Sosyal Güvenlik Kurumu başvurusu.',
  'Fiyat 10 TL 5000 adet için geçerli.',
  'Kargo 34 KG 1000 parça içerir.',
  'Cadde ve sokaklarda düzenleme yapılır.',
  'Madde 12 ve 345 uyarınca.',
];

describe('KK-P08-9: zor negatifler maskelenmez (026 §6.6)', () => {
  for (const t of HARD_NEGATIVES) {
    it(`KK-P08-9 ${t}`, () => {
      expect(detectPii(t, { level: 'strict' })).toEqual([]);
      expect(maskedText(t)).toBe(t);
    });
  }
});

describe('KK-P08-9: algılayıcı örnekleri (026 §6.3-§6.4)', () => {
  const cases: [string, Tip[]][] = [
    ['IBAN TR33 0006 1005 1978 6457 8413 26 hesabı.', ['IBAN']],
    ['IBAN TR33-0006-1005-1978-6457-8413-26 hesabı.', ['IBAN']],
    ['Bozuk TR33 0006 1005 1978 6457 8413 27 hesabı.', []],
    ['E-posta ali.veli@example.org adresi.', ['EPOSTA']],
    ['Kimlik: 10000000146.', ['TCKN']],
    ['Plaka 06 AB 1234 ve 34 A 2345 araçlar.', ['PLAKA', 'PLAKA']],
    ['Plaka 34 QW 123 değil.', []],
    ['Doğum tarihi: 12 Mart 1985 olarak yazılı.', ['TARIH_DOGUM']],
    ['12.03.1985 doğumlu tanık.', ['TARIH_DOGUM']],
    ['Davanın açıldığı tarih 12.03.1985 idi.', []],
    ['Hasta depresyon ve anksiyete bozukluğu yaşadı.', ['SAGLIK', 'SAGLIK']],
    ['Maluliyet oranı ve bilirkişi raporu.', []],
    ['Ege Gıda San. ve Tic. Ltd. Şti. ile sözleşme.', ['SIRKET']],
    ['Adres: Gülpınar Mahallesi 1453. Sokak No: 12 Daire: 4 Bornova/İzmir', ['ADRES']],
    ['davacı Mehmet Kaya vekili Av. Zeynep Demir başvurdu.', ['KISI', 'KISI']],
    ['YILDIZ, Elif bilirkişidir.', ['KISI']],
    ['DAVALI: Selin Aydoğmuş', ['KISI']],
    ['Mehmet geldi.', []],
  ];
  for (const [text, tips] of cases) {
    it(`KK-P08-9 ${text}`, () => {
      expect(detectPii(text, { level: 'strict' }).map((d) => d.tip)).toEqual(tips);
    });
  }

  it("KK-P08-9 VKN: bağlam sözcüğü güveni yükseltir; 5xx telefon VKN'ye üstün", () => {
    const ctx = detectPii('Vergi kimlik no 1234567890', { level: 'standard' });
    expect(ctx).toEqual([expect.objectContaining({ tip: 'VKN', confidence: 'high' })]);
    const bare = detectPii('Numara 1234567890', { level: 'standard' });
    expect(bare).toEqual([expect.objectContaining({ tip: 'VKN', confidence: 'medium' })]);
    expect(detectPii('Numara 5321234567', { level: 'standard' }).map((d) => d.tip)).toEqual([
      'TEL',
    ]);
  });
});

describe('KK-026-16: detectPii, piiDetected, sensitiveTopic (026 §7.7)', () => {
  it('KK-026-16 standard yalnız sözlük + yapısal; strict sezgileri de içerir', () => {
    const text = 'Sayın Mehmet Kaya geldi.';
    expect(piiDetected(text, { level: 'standard' })).toBe(false);
    expect(piiDetected(text, { level: 'strict' })).toBe(true);
    expect(
      piiDetected('Ahmet Yılmaz geldi.', { level: 'standard', dictionary: dictOf(AHMET) }),
    ).toBe(true);
    expect(piiDetected('Kira bedelinin tespiti davası.', { level: 'strict' })).toBe(false);
  });

  it('KK-026-16 sensitiveTopic kodları 002 §11.3 sırasıyla', () => {
    expect(
      sensitiveTopic(
        'Velayet ve nafaka; sanık tutuklandı; kanser tedavisi; mülteci başvurusu; halka arz; ticari sırrın korunması',
      ),
    ).toEqual(['criminal', 'child', 'family', 'health', 'asylum_migration', 'capital_markets']);
    expect(sensitiveTopic('Ticari sır ihlali')).toEqual(['trade_secret']);
    expect(sensitiveTopic('Kira alacağı')).toEqual([]);
  });

  it('KK-026-16 algılama işlevleri girdiyi değiştirmez ve sınıf bilgisi döndürmez (Y-24)', () => {
    const text = 'Tel 0532 123 45 67';
    const d = detectPii(text, { level: 'strict' });
    expect(Object.keys(d[0] ?? {}).sort()).toEqual(['confidence', 'end', 'source', 'start', 'tip']);
    expect(text).toBe('Tel 0532 123 45 67');
  });
});
