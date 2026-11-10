// @tk TK-28
// Sohbet mesajındaki doğrudan atıflar: karar numarası ve kanun maddesi ayrıştırıcısı (saf; numaralar uydurma).
import { describe, expect, it } from 'vitest';
import { parseArticleReferences, parseDecisionReferences } from '../src/kunye/index.ts';

describe('parseDecisionReferences: karar numarasıyla doğrudan erişim', () => {
  it('başlıksız "2023/1234 E., 2024/567 K." esas ve kararı etiketten çözer', () => {
    expect(parseDecisionReferences('2023/1234 E., 2024/567 K. kararını getirir misin?')).toEqual([
      {
        courtClass: null,
        chamberCode: null,
        esasNo: '2023/1234',
        kararNo: '2024/567',
        raw: '2023/1234 E., 2024/567 K.',
      },
    ]);
  });

  it('"Esas No: 2021/44 Karar No: 2022/9" ve "E. 2021/0044" (baştaki sıfır) kanonikleşir', () => {
    expect(parseDecisionReferences('Esas No: 2021/0044 Karar No: 2022/9')[0]).toMatchObject({
      esasNo: '2021/44',
      kararNo: '2022/9',
    });
    expect(parseDecisionReferences('E. 2021/0044 sayılı karar')[0]).toMatchObject({
      esasNo: '2021/44',
      kararNo: null,
    });
  });

  it('tek etiketli numara ile etiketsiz ikinci numara sırayla esas/karar olur', () => {
    expect(parseDecisionReferences('2023/1234 E. 2024/567 numaralı karar')[0]).toMatchObject({
      esasNo: '2023/1234',
      kararNo: '2024/567',
    });
    expect(parseDecisionReferences('2023/1234 - 2024/567 K.')[0]).toMatchObject({
      esasNo: '2023/1234',
      kararNo: '2024/567',
    });
  });

  it('etiketsiz tek numara karar atfı sayılmaz (dosya/sözleşme numarası olabilir)', () => {
    expect(parseDecisionReferences('2023/1234 numaralı dosyada süre ne zaman dolar?')).toEqual([]);
    expect(parseDecisionReferences('Kira tahliye taahhüdü geçerli mi?')).toEqual([]);
  });

  it('"Yargıtay 3. HD 2022/5000 E. 2023/100 K." daire kodunu ve numaraları verir', () => {
    expect(
      parseDecisionReferences('Yargıtay 3. HD 2022/5000 E. 2023/100 K. kararını özetle'),
    ).toEqual([
      {
        courtClass: 'yargitay',
        chamberCode: 'H3',
        esasNo: '2022/5000',
        kararNo: '2023/100',
        raw: 'Yargıtay 3. HD 2022/5000 E. 2023/100 K.',
      },
    ]);
  });

  it('Danıştay dairesi ve genel kurul kodları (D10, HGK) çözülür; istinaf dairesi kod taşımaz', () => {
    expect(parseDecisionReferences('Danıştay 10. Daire 2019/12 E., 2021/3 K.')[0]).toMatchObject({
      courtClass: 'danistay',
      chamberCode: 'D10',
    });
    expect(parseDecisionReferences('HGK 2020/3-15 E., 2021/7 K.')[0]).toMatchObject({
      courtClass: 'yargitay',
      chamberCode: 'HGK',
      esasNo: '2020/3-15',
    });
    expect(
      parseDecisionReferences('Ankara BAM 5. Hukuk Dairesi 2020/10 E. 2021/20 K.')[0],
    ).toMatchObject({ courtClass: 'istinaf_hukuk', chamberCode: null });
  });

  it('başlıklı atıf varken başlıksız numaralar ikinci kez üretilmez', () => {
    const refs = parseDecisionReferences('Yargıtay 9. HD 2022/1 E. 2023/2 K.; ayrıca 2020/5 E.');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.chamberCode).toBe('H9');
  });
});

describe('parseArticleReferences: madde odaklı mevzuat', () => {
  it('"TBK 125", "HMK m. 119", "6098 sayılı Kanun 27. madde" kanun no + madde anahtarına çözülür', () => {
    expect(parseArticleReferences('TBK 125 ne diyor?')).toEqual([
      { lawNo: '6098', lawShort: 'TBK', articleNo: '125', raw: 'TBK 125' },
    ]);
    expect(parseArticleReferences('HMK m. 119 unsurları')).toEqual([
      { lawNo: '6100', lawShort: 'HMK', articleNo: '119', raw: 'HMK m. 119' },
    ]);
    expect(parseArticleReferences('6098 sayılı Kanun 27. madde')).toEqual([
      { lawNo: '6098', lawShort: 'TBK', articleNo: '27', raw: '6098 sayılı Kanun 27. madde' },
    ]);
  });

  it('kısaltma sözlüğü: TMK, CMK, TCK, İİK, TTK, İşK, KVKK, HUMK', () => {
    const laws = (t: string) => parseArticleReferences(t).map((r) => r.lawNo);
    expect(laws('TMK m. 2, CMK m. 100, TCK m. 53, İİK m. 72')).toEqual([
      '4721',
      '5271',
      '5237',
      '2004',
    ]);
    expect(laws('TTK m. 18, İşK m. 25, KVKK m. 11, HUMK m. 275')).toEqual([
      '6102',
      '4857',
      '6698',
      '1086',
    ]);
  });

  it('geçici madde, harfli madde ve aralık; yinelenen atıf tekilleşir; bilinmeyen kısaltma atılır', () => {
    expect(
      parseArticleReferences('TBK geçici m. 1 ve TBK m. 344/A').map((r) => r.articleNo),
    ).toEqual(['G1', '344']);
    expect(parseArticleReferences('HMK m. 119-121').map((r) => r.articleNo)).toEqual([
      '119',
      '120',
      '121',
    ]);
    expect(parseArticleReferences('TBK m. 125; yine TBK m. 125')).toHaveLength(1);
    expect(parseArticleReferences('XYZK m. 5')).toEqual([]);
  });

  it('madde atfı olmayan metin boş döner', () => {
    expect(parseArticleReferences('Kira sözleşmesi feshi için ne yapmalıyım?')).toEqual([]);
  });
});
