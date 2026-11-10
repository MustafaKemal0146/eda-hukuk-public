// @tk TK-18
// KK-P11-17 / KK-034-10: mevzuat madde ve fıkra ayrıştırıcı (034 §9.3). Metinler SENTETİK yapı
// örnekleridir: gerçek kanun metni değildir, yalnız işaretçi biçimlerini (madde başlığı, MADDE satırı,
// fıkra numarası, değişiklik notu) taşır. Gerçek kanun metniyle altın testler P15'tedir.
import { describe, expect, it } from 'vitest';
import { parseLawArticles, splitParagraphs } from '../src/sections/index.ts';

const SAMPLE = [
  'BİRİNCİ KISIM',
  'Örnek Kısım Adı',
  'Örnek başlık bir',
  'MADDE 49- (1) Birinci fıkra cümlesi.',
  '(2) İkinci fıkra cümlesi; 3 üncü maddesinin (2) numaralı bendi saklıdır.',
  '(3) Üçüncü fıkra cümlesi.',
  'Örnek başlık iki',
  'Madde 49/A – Tek fıkralı örnek cümle. (Ek: 1/2/2020-7000/5 md.)',
  'İKİNCİ BÖLÜM',
  'MADDE 50 — (Mülga: 3/4/2021-7100/2 md.)',
  'Mükerrer Madde 18- Mükerrer örnek cümle.',
  'Ek Madde 3- (Değişik: 5/6/2022-7200/1 md.) Ek örnek cümle. (Değişik: 7/8/2023-7300/4 md.)',
  'GEÇİCİ MADDE 5- (1) Geçici örnek cümle. (2) İkinci geçici fıkra.',
  'Madde 5- Geçici madde 5 ile karışmayan ayrı anahtar.',
].join('\n');

describe('KK-P11-17 / KK-034-10: madde ayrıştırıcı anahtarları', () => {
  const arts = parseLawArticles(SAMPLE);
  const by = new Map(arts.map((a) => [a.key, a]));

  it('49, 49/A, M18, E3, G5 ve ayrı anahtar uzayındaki 5', () => {
    expect(arts.map((a) => a.key)).toEqual(['49', '49/A', '50', 'M18', 'E3', 'G5', '5']);
    expect(by.get('G5')?.kind).toBe('gecici');
    expect(by.get('E3')?.kind).toBe('ek');
    expect(by.get('M18')?.kind).toBe('mukerrer');
    expect(by.get('49/A')?.letter).toBe('A');
  });

  it('madde başlığı: hemen önceki kısa satır; kısım/bölüm başlığı madde sınırı ve başlık değildir', () => {
    expect(by.get('49')?.title).toBe('Örnek başlık bir');
    expect(by.get('49/A')?.title).toBe('Örnek başlık iki');
    expect(by.get('50')?.title).toBeNull();
    expect(by.get('49')?.text).not.toContain('Örnek başlık iki');
    expect(by.get('49/A')?.text).not.toContain('İKİNCİ BÖLÜM');
  });

  it('"maddesinin (2) numaralı bendi" fıkra sayılmaz; fıkralar ardışık', () => {
    const paras = by.get('49')?.paragraphs ?? [];
    expect(paras.map((p) => p.no)).toEqual([1, 2, 3]);
    expect(paras[1]?.text).toContain('numaralı bendi saklıdır');
    expect(by.get('G5')?.paragraphs.map((p) => p.no)).toEqual([1, 2]);
    expect(by.get('49/A')?.paragraphs).toHaveLength(1);
  });

  it('mülga madde repealed; değişiklik notu ve en geç tarih ISO', () => {
    expect(by.get('50')?.status).toBe('repealed');
    expect(by.get('49')?.status).toBe('active');
    expect(by.get('49/A')?.amendedAt).toBe('2020-02-01');
    expect(by.get('E3')?.amendedAt).toBe('2023-08-07');
    expect(by.get('E3')?.amendedNote).toContain('(Değişik: 5/6/2022-7200/1 md.)');
  });

  it('satır sonu olmayan (PDF) metinde işaretçiye dayanır', () => {
    const flat = 'MADDE 1- (1) Bir. (2) İki. MADDE 2- Tek. GEÇİCİ MADDE 1- Geçici.';
    expect(parseLawArticles(flat).map((a) => a.key)).toEqual(['1', '2', 'G1']);
  });

  it('cümle içi madde atfı yeni madde başlatmaz; sırası bozuk fıkra işaretçisi reddedilir', () => {
    expect(parseLawArticles('MADDE 7- Bu konuda madde 8 - hükmü uygulanır.')).toHaveLength(1);
    expect(splitParagraphs('(1) Bir. (3) Üç. (2) İki.').map((p) => p.no)).toEqual([1, 2]);
  });

  it('":" ile biten kenar başlığı başlıktır; dipnot işareti ve ":" başlıktan atılır (AS-0350)', () => {
    const text = [
      'Örnek başlık:[4]',
      'Madde 1 – Birinci örnek cümle',
      '',
      'Örnek kaldırma başlığı:',
      'Madde 2 – İkinci örnek cümle.',
    ].join('\n');
    const arts = parseLawArticles(text);
    expect(arts.map((a) => [a.key, a.title])).toEqual([
      ['1', 'Örnek başlık'],
      ['2', 'Örnek kaldırma başlığı'],
    ]);
    expect(arts[0]?.text).toBe('Birinci örnek cümle');
  });
});
