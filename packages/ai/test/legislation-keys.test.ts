//  regresyon: yargi-mcp `article_no` 034 §9.3 anahtarıdır (352, 352/A, G1, E3, M18) ve
// `markdown` "**Madde n –**" öneki taşımaz. Künye gösterimi 081 §4.3, kaynak anahtarı `mevzuat:<kanun>:
// <kanonik madde>` her girdi biçiminde aynı kalır. Madde metinleri biçim örneğidir, gerçek metin değildir.
import { describe, expect, it } from 'vitest';
import {
  MemoryRefStore,
  newTurnBudget,
  type SourceBackend,
  type ToolContext,
} from '../src/index.ts';
import { getLegislationArticle, searchLegislation } from '../src/tools/handlers/legislation.ts';
import {
  canonicalArticleNo,
  lawArticleTitle,
  lawHitKey,
  lawShortKunye,
  lawSourceKey,
} from '../src/tools/kunye.ts';

describe('AS-0349 lawShortKunye: 034 §9.3 anahtarı → 081 §4.3 gösterimi', () => {
  it('geçici, ek, mükerrer ve harfli madde', () => {
    const rows: [string, string][] = [
      ['352', 'TBK m. 352'],
      ['352/A', 'TBK m. 352/A'],
      ['G1', 'TBK geçici m. 1'],
      ['E3', 'TBK ek m. 3'],
      ['M18', 'TBK m. 18 (mükerrer)'],
      ['G2/A', 'TBK geçici m. 2/A'],
      // Model / kullanıcı girdisi ve P11 öncesi biçim aynı gösterime iner.
      ['Geçici 1', 'TBK geçici m. 1'],
      ['GEÇİCİ 1', 'TBK geçici m. 1'],
      ['EK 3', 'TBK ek m. 3'],
      ['344-346', 'TBK m. 344-346'],
      ['G1-G3', 'TBK geçici m. 1-3'],
      ['geçici 1-3', 'TBK geçici m. 1-3'],
    ];
    for (const [key, text] of rows)
      expect(lawShortKunye('6098', 'Türk Borçlar Kanunu', key), key).toBe(text);
    expect(lawShortKunye('6098', 'Türk Borçlar Kanunu', null)).toBe('TBK');
    // Sözlükte olmayan kanun 081 §6 yedeği.
    expect(lawShortKunye('7777', 'Örnek Kanun', 'G5')).toBe('7777 s. K. geçici m. 5');
    expect(lawShortKunye('6098', '', 'TBK G1')).not.toMatch(/m\. G1|GEÇİCİ/u);
  });

  it('kaynak anahtarı kanoniktir; başlık 081 §4.3 gösterimini kullanır', () => {
    expect(canonicalArticleNo('Geçici Madde 1')).toBe('G1');
    expect(canonicalArticleNo('344 - 346')).toBe('344-346');
    expect(canonicalArticleNo('49-a')).toBe('49/A');
    expect(lawSourceKey('6098', 'Geçici 1')).toBe(lawSourceKey('6098', 'G1'));
    expect(lawSourceKey('6098', 'GEÇİCİ 1')).toBe('mevzuat:6098:G1');
    expect(lawSourceKey('6098', null)).toBe('mevzuat:6098:');
    expect(
      lawHitKey({
        law_no: '6098',
        law_name: 'Türk Borçlar Kanunu',
        article_no: 'E3',
        title: 't',
        snippet: null,
        url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098',
        last_amended_at: null,
        retrieved_at: '2026-10-10',
      }),
    ).toBe('mevzuat:6098:E3');
    expect(lawArticleTitle('6098', 'Türk Borçlar Kanunu', 'G1')).toBe(
      '6098 sayılı Türk Borçlar Kanunu geçici m. 1',
    );
  });
});

function ctxWith(backend: SourceBackend): ToolContext {
  return {
    backend,
    refs: new MemoryRefStore(),
    emit: () => {},
    budget: newTurnBudget(),
    turnRefs: new Set(),
    today: '2026-10-10',
    scope: { sources: [], courtTypes: null },
  };
}

const LAW = {
  law_no: '6098',
  law_name: 'Türk Borçlar Kanunu',
  url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098',
  retrieved_at: '2026-10-10',
  last_amended_at: null,
};

describe('AS-0349 mevzuat araçları yeni anahtar biçimiyle', () => {
  it('get_legislation_article: "Geçici 1" girdisi G1 olarak istenir, etiket arama sonucuyla aynıdır', async () => {
    const asked: { articleNo: string; articleTo: string | null }[] = [];
    const backend: SourceBackend = {
      searchDecisions: async () => ({ results: [], hasMore: false, stale: false }),
      getDecision: async () => {
        throw new Error('çağrılmamalı');
      },
      searchLegislation: async () => ({
        results: [
          {
            law_no: '6098',
            law_name: 'Türk Borçlar Kanunu',
            article_no: 'G1',
            title: 'Türk Borçlar Kanunu geçici m. 1 — Örnek geçiş başlığı',
            snippet: 'Örnek özet',
            url: LAW.url,
            last_amended_at: null,
            retrieved_at: '2026-10-10',
          },
        ],
      }),
      getLegislationArticles: async (q) => {
        asked.push({ articleNo: q.articleNo, articleTo: q.articleTo });
        return {
          ...LAW,
          articles: [
            {
              article_no: 'G1',
              heading: 'Örnek geçiş başlığı',
              markdown: '(1) Örnek geçiş fıkrası.',
              repealed: false,
            },
          ],
        };
      },
    };
    const ctx = ctxWith(backend);
    const signal = new AbortController().signal;

    const found = await searchLegislation(ctx, { query: 'geçiş', law_no: '6098' }, 'c1', signal);
    expect(found.isError).toBe(false);
    const searchRec = ctx.refs.all()[0];
    expect(searchRec).toMatchObject({
      ref: 'K1',
      sourceKey: 'mevzuat:6098:G1',
      shortKunye: 'TBK geçici m. 1',
      law: { articleNo: 'G1' },
    });

    const out = await getLegislationArticle(
      ctx,
      { ref: null, law_no: '6098', article_no: 'Geçici 1', as_of: null },
      'c2',
      signal,
    );
    expect(asked).toEqual([{ articleNo: 'G1', articleTo: null }]);
    expect(out.isError).toBe(false);
    expect(out.detail).toBe('TBK geçici m. 1');
    // Aynı madde aynı etiketi alır (025 §4); yeni kayıt açılmaz.
    expect(ctx.refs.all()).toHaveLength(1);
    expect(out.text).toContain('Geçici Madde 1 — Örnek geçiş başlığı\n(1) Örnek geçiş fıkrası.');
    expect(out.text).not.toMatch(/Madde G1|GEÇİCİ/u);

    // Etiketle yeniden getirme kanonik anahtarı kullanır.
    await getLegislationArticle(
      ctx,
      { ref: 'K1', law_no: null, article_no: null, as_of: null },
      'c3',
      signal,
    );
    expect(asked[1]).toEqual({ articleNo: 'G1', articleTo: null });
  });

  it('aralık ve mükerrer/harfli madde başlıkları', async () => {
    const asked: { articleNo: string; articleTo: string | null }[] = [];
    const backend: SourceBackend = {
      searchDecisions: async () => ({ results: [], hasMore: false, stale: false }),
      getDecision: async () => {
        throw new Error('çağrılmamalı');
      },
      searchLegislation: async () => ({ results: [] }),
      getLegislationArticles: async (q) => {
        asked.push({ articleNo: q.articleNo, articleTo: q.articleTo });
        return {
          ...LAW,
          articles: [
            { article_no: '352/A', heading: null, markdown: 'Örnek metin A.', repealed: false },
            { article_no: 'M18', heading: null, markdown: 'Örnek metin M.', repealed: true },
            { article_no: 'E3', heading: 'Ek başlık', markdown: 'Örnek metin E.', repealed: false },
          ],
        };
      },
    };
    const ctx = ctxWith(backend);
    const out = await getLegislationArticle(
      ctx,
      { ref: null, law_no: '6098', article_no: 'geçici 1 - 3', as_of: null },
      'c1',
      new AbortController().signal,
    );
    expect(asked).toEqual([{ articleNo: 'G1', articleTo: 'G3' }]);
    expect(ctx.refs.all()[0]).toMatchObject({
      sourceKey: 'mevzuat:6098:G1-G3',
      shortKunye: 'TBK geçici m. 1-3',
      title: '6098 sayılı Türk Borçlar Kanunu geçici m. 1-3',
    });
    expect(out.text).toContain('Madde 352/A\nÖrnek metin A.');
    expect(out.text).toContain('Mükerrer Madde 18 (mülga)\nÖrnek metin M.');
    expect(out.text).toContain('Ek Madde 3 — Ek başlık\nÖrnek metin E.');
  });
});
