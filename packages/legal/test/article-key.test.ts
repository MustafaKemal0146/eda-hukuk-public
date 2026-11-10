// madde anahtarı (034 §9.3) ortak ayrıştırıcısı; yargi-mcp `article_no`, api ve ai tüketicileri
// aynı işlevi kullanır. 081 §4.3 aralık gösterimi. Numaralar biçim örneğidir.
import { describe, expect, it } from 'vitest';
import {
  articleHeadingText,
  formatArticleRef,
  normalizeArticleKey,
  parseArticleSpan,
} from '../src/kunye/index.ts';

describe('AS-0349: madde anahtarı ortak ayrıştırıcısı', () => {
  it('girdi biçimleri kanonik anahtara iner', () => {
    const rows: [string, string | null][] = [
      ['352', '352'],
      ['352/a', '352/A'],
      ['G5', 'G5'],
      ['g5', 'G5'],
      ['Geçici 5', 'G5'],
      ['GEÇİCİ 5', 'G5'],
      ['GEÇİCİ MADDE 5', 'G5'],
      ['Ek 3', 'E3'],
      ['EK 3', 'E3'],
      ['Mükerrer 18', 'M18'],
      ['M18', 'M18'],
      ['Madde 7', '7'],
      ['12/ç', '12/Ç'],
      ['kira', null],
    ];
    for (const [input, key] of rows) expect(normalizeArticleKey(input), input).toBe(key);
  });

  it('aralık girdisi; tire sonrası tek harf harfli maddedir', () => {
    expect(parseArticleSpan('344-346')).toEqual({ from: '344', to: '346' });
    expect(parseArticleSpan('G1-G5')).toEqual({ from: 'G1', to: 'G5' });
    expect(parseArticleSpan('Geçici 1 - Geçici 5')).toEqual({ from: 'G1', to: 'G5' });
    expect(parseArticleSpan('geçici 1-5')).toEqual({ from: 'G1', to: 'G5' });
    expect(parseArticleSpan('49-A')).toEqual({ from: '49/A', to: null });
    expect(parseArticleSpan('7-7')).toEqual({ from: '7', to: null });
    expect(parseArticleSpan('a-b')).toBeNull();
  });

  it('başlık satırı ve aralıklı atıf gösterimi', () => {
    expect(articleHeadingText('352/A')).toBe('Madde 352/A');
    expect(articleHeadingText('G1')).toBe('Geçici Madde 1');
    expect(articleHeadingText('E3')).toBe('Ek Madde 3');
    expect(articleHeadingText('M18')).toBe('Mükerrer Madde 18');
    const ref = (keys: string[]) =>
      formatArticleRef({
        lawNo: '6098',
        articles: keys.map((key) => ({ key, paragraph: null, sub: null })),
        range: true,
      });
    expect(ref(['344', '346'])).toBe('TBK m. 344-346');
    expect(ref(['G1', 'G3'])).toBe('TBK geçici m. 1-3');
    expect(ref(['E1', 'E2'])).toBe('TBK ek m. 1-2');
  });
});
