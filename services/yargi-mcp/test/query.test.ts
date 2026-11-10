// @tk TK-28
// madde düzeyinde mevzuat sıralaması ve kanun adı çözümü.
import { describe, expect, it } from 'vitest';
import { lawNoFromQuery, queryTerms, rankArticles } from '../src/transform/query.ts';

describe('Sorgu yardımcıları', () => {
  it('Türkçe katlama ve durdurma listesi', () => {
    expect(queryTerms('Kiracının TAHLİYE taahhüdü ve şartları')).toEqual([
      'kiracinin',
      'tahliye',
      'taahhudu',
    ]);
  });

  it('kanun adı/kısaltması numaraya çözülür', () => {
    expect(lawNoFromQuery('TBK tahliye taahhüdü')).toBe('6098');
    expect(lawNoFromQuery('Türk Borçlar Kanunu kira')).toBe('6098');
    expect(lawNoFromQuery('İcra ve İflas Kanunu itiraz')).toBe('2004');
    expect(lawNoFromQuery('kira bedeli')).toBeNull();
  });

  it('maddeler ek toleranslı terim eşleşmesiyle sıralanır, mülga atlanır', () => {
    const articles = [
      {
        articleNo: '315',
        heading: 'Kiracının temerrüdü',
        markdown: 'Kiracı kira bedelini ödemezse…',
        repealed: false,
      },
      {
        articleNo: '352',
        heading: 'Kiracıdan kaynaklanan sebeplerle / Yazılı tahliye taahhüdü',
        markdown:
          'Kiracı, kiralananın teslim edilmesinden sonra, kiraya verene karşı, kiralananı belli bir tarihte boşaltmayı yazılı olarak üstlendiği hâlde boşaltmamışsa…',
        repealed: false,
      },
      { articleNo: '999', heading: 'Tahliye taahhüdü', markdown: 'Mülga', repealed: true },
    ];
    const ranked = rankArticles(articles, 'TBK tahliye taahhüdü', 5);
    expect(ranked[0]?.item.articleNo).toBe('352');
    expect(ranked.map((r) => r.item.articleNo)).not.toContain('999');
    expect(ranked[0]?.snippet.length).toBeLessThanOrEqual(300);
  });

  it('AS-0070: uygulama terimi kanun metnindeki karşılığıyla eşleşir (tahliye → boşaltma)', () => {
    const articles = [
      {
        articleNo: '128',
        heading: 'B. Üçüncü kişinin fiilini üstlenme',
        markdown: 'Üçüncü kişinin fiilini üstlenen kişi…',
        repealed: false,
      },
      {
        articleNo: '347',
        heading: 'Bildirim yoluyla',
        markdown:
          'Konut ve çatılı işyeri kiralarında kiracı, belirli süreli sözleşmelerin süresinin bitiminden en az onbeş gün önce bildirimde bulunmadıkça…',
        repealed: false,
      },
      {
        articleNo: '352',
        heading: '2. Kiracıdan kaynaklanan sebeplerle',
        markdown:
          'Kiracı, kiralananın teslim edilmesinden sonra, kiraya verene karşı, kiralananı belli bir tarihte boşaltmayı yazılı olarak üstlendiği hâlde boşaltmamışsa…',
        repealed: false,
      },
    ];
    expect(rankArticles(articles, 'tahliye taahhüdü', 5)[0]?.item.articleNo).toBe('352');
  });
});
