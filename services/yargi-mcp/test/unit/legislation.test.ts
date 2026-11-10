// @tk TK-28
// Mevzuat canlı yolu (021 §5.7.4): Bedesten mevzuat araması ve konsolide metinden madde bölme
// (kayıtlı resmî yanıtlar: "borçlar" ad araması, 2893 sayılı Kanun). Madde bölme `@eda/legal`
// `parseLawArticles` ile (034 §9.3, KK-P11-17); anahtarlar `352`, `352/A`, `G1`, `E3`.
import { McpGetLegislationLiveSuccess, McpSearchLegislationLiveSuccess } from '@eda/contracts/mcp';
import { describe, expect, it } from 'vitest';
import {
  type LawArticle,
  normalizeArticleNo,
  selectArticles,
  splitLawArticles,
} from '../../src/sources/mevzuat/articles.ts';
import { getLegislationLive, searchLegislationLive } from '../../src/tools/legislation.ts';
import { htmlToMarkdown } from '../../src/transform/convert.ts';
import { CTX, makeDeps, replay } from '../helpers.ts';

describe('search_legislation_live', () => {
  it('ad araması: TBK sonuçlarda, tür/ref/URL eşlemesi şemaya uyar', async () => {
    const deps = makeDeps({ transport: replay().transport });
    const out = await searchLegislationLive(
      deps,
      { query: 'borçlar', law_no: null, page: 1, page_size: 5 },
      CTX,
    );
    expect(McpSearchLegislationLiveSuccess.parse(out)).toBeTruthy();
    const tbk = out.results.find((h) => h.law_no === '6098');
    expect(tbk).toMatchObject({
      law_type: 'kanun',
      law_name: 'TÜRK BORÇLAR KANUNU',
      mevzuat_ref: '1.5.6098',
      url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098&MevzuatTur=1&MevzuatTertip=5',
    });
  });
});

describe('get_legislation_live', () => {
  it('2893 m.1–2: madde metni ve kenar başlığı; ikinci çağrı tampondan', async () => {
    const t = replay();
    const deps = makeDeps({ transport: t.transport });
    const args = { law_no: '2893', law_type: null, article_no: '1', article_to: '2' };
    const out = await getLegislationLive(deps, args, CTX);
    expect(McpGetLegislationLiveSuccess.parse(out)).toBeTruthy();
    expect(out.law_name).toBe('TÜRK BAYRAĞI KANUNU');
    expect(out.articles.map((a) => [a.article_no, a.heading])).toEqual([
      ['1', 'Amaç'],
      ['2', 'Bayrağın Şekli ve Yapımı'],
    ]);
    // Madde metni işaretçiden ("Madde 1 –") sonrasıdır; vurgu işaretleri atılır (034 §9.3 `text`).
    expect(out.articles[0]?.markdown).toMatch(/^Bu Kanunun amacı/);
    expect(out.articles.every((a) => !a.markdown.includes('**'))).toBe(true);
    const again = await getLegislationLive(
      deps,
      { ...args, article_no: '4', article_to: null },
      CTX,
    );
    expect(again.cached).toBe(true);
    expect(t.calls).toHaveLength(2);
  });

  it('2893 m.6–10: dipnotlu ve ":" ile biten kenar başlıkları; başlık önceki maddenin gövdesine girmez', async () => {
    const deps = makeDeps({ transport: replay().transport });
    const out = await getLegislationLive(
      deps,
      { law_no: '2893', law_type: null, article_no: '6', article_to: '10' },
      CTX,
    );
    expect(out.articles.map((a) => [a.article_no, a.heading])).toEqual([
      ['6', 'Bayrağın Örtülebileceği Yerler'],
      ['7', 'Yasaklar'],
      ['8', 'Cezalar'],
      ['9', 'Yönetmelik'],
      ['10', 'Yürürlükten kaldırılan kanun'],
    ]);
    expect(out.articles.find((a) => a.article_no === '9')?.markdown).not.toContain('Yürürlükten');
    expect(out.warnings).toEqual([]);
  });

  it('olmayan madde SOURCE_DOCUMENT_NOT_FOUND', async () => {
    const deps = makeDeps({ transport: replay().transport });
    await expect(
      getLegislationLive(
        deps,
        { law_no: '2893', law_type: null, article_no: '999', article_to: null },
        CTX,
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_DOCUMENT_NOT_FOUND' });
  });
});

describe('KK-P11-17: madde bölücü @eda/legal ayrıştırıcısıyla (TBK biçimi, kısa alıntı)', () => {
  // mevzuat.gov.tr Word çıktısı biçimi: kenar başlığı h2, madde satırı <b>MADDE n- </b>.
  const html = `
    <h2>b. Yeni malikin gereksinimi</h2>
    <p><b>MADDE 351- </b>Kiralananı sonradan edinen kişi, ... sona erdirebilir.</p>
    <p>&nbsp;</p>
    <h2>2. Kiracıdan kaynaklanan sebeplerle</h2>
    <p><b>MADDE 352- </b>Kiracı, kiralananın teslim edilmesinden sonra, ... sona erdirebilir.</p>
    <p>Kiracı, bir yıldan kısa süreli kira sözleşmelerinde ... sona erdirebilir.</p>
    <p><b>MADDE 352/A- </b>Örnek harfli madde cümlesi.</p>
    <h2>3. Dava süresinin uzaması</h2>
    <p><b>MADDE 353- </b>Kiraya veren, ... uzamış olur.</p>
    <p><b>GEÇİCİ MADDE 1- </b>(Mülga: 1/1/2020 - 1234/1 md.)</p>
    <p><b>Geçici Madde 2- </b>Örnek geçici madde cümlesi.</p>
    <p><b>EK MADDE 3- </b>Örnek ek madde cümlesi.</p>`;
  const arts = splitLawArticles(htmlToMarkdown(html));

  it('başlık sonraki maddeye taşınır; madde gövdesi sonraki başlığı içermez; 034 §9.3 anahtarları', () => {
    expect(arts.map((a) => a.articleNo)).toEqual(['351', '352', '352/A', '353', 'G1', 'G2', 'E3']);
    expect(arts[0]?.heading).toBe('b. Yeni malikin gereksinimi');
    const m352 = arts.find((a) => a.articleNo === '352');
    expect(m352?.heading).toBe('2. Kiracıdan kaynaklanan sebeplerle');
    expect(m352?.markdown).toContain('bir yıldan kısa süreli');
    expect(m352?.markdown).not.toContain('Dava süresinin uzaması');
    expect(arts.find((a) => a.articleNo === '353')?.heading).toBe('3. Dava süresinin uzaması');
    expect(arts.find((a) => a.articleNo === 'G1')?.repealed).toBe(true);
    expect(arts.find((a) => a.articleNo === 'G2')?.repealed).toBe(false);
  });

  it('girdi madde numarası anahtara çevrilir (Geçici / GEÇİCİ MADDE / G, Ek / E, harf)', () => {
    expect(
      [
        '352',
        '352/a',
        '352 / A',
        'Geçici 1',
        'GEÇİCİ MADDE 1',
        'g1',
        'Ek 3',
        'E3',
        'Mükerrer 18',
      ].map(normalizeArticleNo),
    ).toEqual(['352', '352/A', '352/A', 'G1', 'G1', 'G1', 'E3', 'E3', 'M18']);
    expect(selectArticles(arts, 'Geçici 1', null, 5).articles.map((a) => a.articleNo)).toEqual([
      'G1',
    ]);
  });

  it('aralık aynı türde kurulur; harfli madde sayı parçasıyla girer; tür karışırsa tek madde', () => {
    const ids = (from: string, to: string | null) =>
      selectArticles(arts, from, to, 5).articles.map((a) => a.articleNo);
    expect(ids('351', '353')).toEqual(['351', '352', '352/A', '353']);
    expect(ids('G1', 'Geçici 2')).toEqual(['G1', 'G2']);
    expect(ids('352', 'G2')).toEqual(['352']);
    expect(ids('353', '351')).toEqual(['353']);
    expect(ids('999', null)).toEqual([]);
  });

  it('aralık en çok 5 madde; aşılırsa truncated', () => {
    const many: LawArticle[] = Array.from({ length: 8 }, (_, i) => ({
      articleNo: String(i + 1),
      heading: null,
      markdown: `Madde ${i + 1}`,
      repealed: false,
      amendedAt: null,
    }));
    const r = selectArticles(many, '1', '8', 5);
    expect([r.articles.length, r.truncated]).toEqual([5, true]);
  });
});
