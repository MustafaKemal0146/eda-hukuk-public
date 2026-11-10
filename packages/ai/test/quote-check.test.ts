// @tk TK-12
// Alıntı denetimi (025 §6), tur sonu: tur belleği (araçla getirilen metin) + tek yeniden getirme.
// Fail-safe: uyuşmazlık yalnız kaynağın tam metniyle kanıtlanınca bildirilir. Veriler sentetiktir.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { scopeToRequest } from '@eda/contracts/scope';
import type { SearchDecisionsInput } from '@eda/contracts/tools';
import { describe, expect, it } from 'vitest';
import {
  type DecisionDoc,
  type DecisionHit,
  MemoryRefStore,
  type QuoteTextMemory,
  type SourceBackend,
  SourceError,
  type SourceRecord,
  type ToolContext,
} from '../src/tools/context.ts';
import { newTurnBudget } from '../src/tools/execute.ts';
import { searchDecisions } from '../src/tools/handlers/decisions.ts';
import { getLegislationArticle, searchLegislation } from '../src/tools/handlers/legislation.ts';
import { checkCitationQuotes } from '../src/tools/quote-check.ts';

const GEREKCE =
  'Somut olayda işçinin fazla çalışma ücretine hak kazanması için fazla çalışmanın yazılı delille ' +
  'ispatı gerekir.\n\nMahkemece bu yön gözetilmeden eksik inceleme ile hüküm kurulması isabetsizdir.';
const HUKUM = 'Hükmün bozulmasına oy birliğiyle karar verildi.';

const hit = (n: number, snippet: string | null = null): DecisionHit => ({
  source: 'bedesten',
  document_id: `doc-${n}`,
  court_type: 'yargitay',
  court: 'Yargıtay',
  chamber: '9. Hukuk Dairesi',
  esas_no: `2020/${n}`,
  karar_no: `2021/${n}`,
  decision_date: '2021-05-10',
  title: `Örnek karar ${n}`,
  snippet,
  url: `https://example.invalid/${n}`,
  retrieved_at: '2026-10-11',
});

const doc = (h: DecisionHit): DecisionDoc => ({
  ...h,
  text_status: 'ok',
  total_sections: 3,
  sections: [
    { no: 1, role: 'kunye', chars: 20, markdown: 'Künye bloğu' },
    { no: 2, role: 'gerekce', chars: GEREKCE.length, markdown: GEREKCE },
    { no: 3, role: 'hukum', chars: HUKUM.length, markdown: HUKUM },
  ],
});

function setup(hits: DecisionHit[], opts: { failRead?: boolean } = {}) {
  const reads: string[] = [];
  const backend: SourceBackend = {
    async searchDecisions() {
      return { results: hits, hasMore: false, stale: false };
    },
    async getDecision(_source, id) {
      reads.push(id);
      if (opts.failRead) throw new SourceError('SOURCE_UNAVAILABLE');
      const h = hits.find((x) => x.document_id === id);
      if (!h) throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND');
      return doc(h);
    },
    async searchLegislation() {
      return {
        results: [
          {
            law_no: '6098',
            law_name: 'Türk Borçlar Kanunu',
            article_no: '352',
            title: 'Kiracının borçlarına aykırılık',
            snippet: 'Kiracı, kiralananı boşaltmayı yazılı olarak üstlenmişse',
            url: 'https://www.mevzuat.gov.tr/x',
            last_amended_at: null,
            retrieved_at: '2026-10-11',
          },
        ],
      };
    },
    async getLegislationArticles() {
      return {
        law_no: '6098',
        law_name: 'Türk Borçlar Kanunu',
        url: 'https://www.mevzuat.gov.tr/x',
        retrieved_at: '2026-10-11',
        last_amended_at: null,
        articles: [
          {
            article_no: '352',
            heading: null,
            markdown:
              'Kiracı, kiralananın tesliminden sonra boşaltma tarihini yazılı olarak bildirmişse.',
            repealed: false,
          },
        ],
      };
    },
  };
  const quoteTexts: QuoteTextMemory = new Map();
  const ctx: ToolContext = {
    backend,
    refs: new MemoryRefStore(),
    emit: () => {},
    budget: newTurnBudget(),
    turnRefs: new Set(),
    today: '2026-10-11',
    scope: scopeToRequest(null),
    quoteTexts,
  };
  return { ctx, reads, backend, quoteTexts };
}

const search: SearchDecisionsInput = {
  query: 'fazla çalışma ispatı',
  court_types: null,
  chamber: null,
  date_from: null,
  date_to: null,
  esas_no: null,
  karar_no: null,
  page: null,
  live: true,
};
const signal = new AbortController().signal;

function check(s: ReturnType<typeof setup>, text: string) {
  return checkCitationQuotes({
    text,
    refs: s.ctx.refs,
    memory: s.quoteTexts,
    backend: s.backend,
    signal,
  });
}

describe('Alıntı denetimi: tur belleği', () => {
  it('okunan kararın tam metni bellekte tutulur; doğru alıntı eşleşir, yeniden getirme yok', async () => {
    const s = setup([hit(1)]);
    await searchDecisions(s.ctx, search, 'c1', signal);
    expect(s.quoteTexts.get('K1')?.some((t) => t.complete)).toBe(true);
    const before = s.reads.length;
    // Hüküm bölümü modele özüt olarak verilmese de kararın tam metninde vardır.
    const r = await check(
      s,
      'Karar, "fazla çalışmanın yazılı delille ispatı gerekir" der [K1]; "Hükmün bozulmasına oy birliğiyle" [K1].',
    );
    expect([...r.mismatched]).toEqual([]);
    expect(r.checked).toBe(2);
    expect(s.reads.length).toBe(before);
  });

  it('tam metinde olmayan alıntı uyuşmazlıktır; yeniden getirme yapılmaz', async () => {
    const s = setup([hit(1)]);
    await searchDecisions(s.ctx, search, 'c1', signal);
    const before = s.reads.length;
    const r = await check(
      s,
      'Kararda "fazla çalışmanın tanık beyanıyla ispatı mümkündür" denir [K1].',
    );
    expect([...r.mismatched]).toEqual(['K1']);
    expect(s.reads.length).toBe(before);
  });

  it('alıntısız ve atıfsız metinde denetim yapılmaz', async () => {
    const s = setup([hit(1)]);
    await searchDecisions(s.ctx, search, 'c1', signal);
    const before = s.reads.length;
    const r = await check(
      s,
      'Fazla çalışma yazılı delille ispatlanır [K1]. Kanun "fazla çalışmanın tanıkla ispatı mümkündür" der.',
    );
    expect(r).toEqual({ mismatched: new Set(), checked: 0, unchecked: 0 });
    expect(s.reads.length).toBe(before);
  });
});

describe('Alıntı denetimi: tam metin yoksa tek yeniden getirme', () => {
  it('yalnız özet görülmüşse karar bir kez yeniden getirilir; alıntı tam metinde varsa uyuşmazlık yok', async () => {
    const s = setup([hit(1, 'Kısa özet: fazla çalışma ispatı.')]);
    await searchDecisions(s.ctx, search, 'c1', signal);
    expect(s.reads).toEqual([]);
    const r = await check(s, '"eksik inceleme ile hüküm kurulması isabetsizdir" [K1]');
    expect(s.reads).toEqual(['doc-1']);
    expect([...r.mismatched]).toEqual([]);
    expect(r.checked).toBe(1);
  });

  it('yeniden getirilen tam metinde de yoksa uyuşmazlıktır; aynı karar için tek çağrı', async () => {
    const s = setup([hit(1, 'Kısa özet.')]);
    await searchDecisions(s.ctx, search, 'c1', signal);
    const r = await check(
      s,
      '"fazla çalışmanın tanıkla ispatı mümkündür" [K1] ve "işverenin ispat yükü bulunmamaktadır" [K1].',
    );
    expect(s.reads).toEqual(['doc-1']);
    expect([...r.mismatched]).toEqual(['K1']);
  });

  it('yeniden getirme başarısızsa kanıt yoktur: durum değişmez (denetlenemedi)', async () => {
    const s = setup([hit(1, 'Kısa özet.')], { failRead: true });
    await searchDecisions(s.ctx, search, 'c1', signal);
    const r = await check(s, '"fazla çalışmanın tanıkla ispatı mümkündür" [K1]');
    expect(s.reads).toEqual(['doc-1']);
    expect([...r.mismatched]).toEqual([]);
    expect(r.unchecked).toBe(1);
  });

  it('önceki turdan gelen karar (yalnız özüt) yeniden getirilir; bütçe aşımı denetlenmez', async () => {
    const max = CONFIG_DEFAULTS['citations.maxLivePerMessage'];
    const hits = Array.from({ length: max + 1 }, (_, i) => hit(i + 1));
    const s = setup(hits);
    for (const h of hits) {
      const rec: SourceRecord = {
        ref: `K${h.document_id.slice(4)}`,
        kind: 'decision',
        sourceKey: `bedesten:${h.document_id}`,
        sourceId: `bedesten:${h.document_id}`,
        shortKunye: 'Örnek',
        title: 'Örnek',
        portal: 'bedesten',
        retrievedAt: '2026-10-01',
        relevance: 'high',
        decision: h,
        excerpt: 'Önceki turda okunan kısa bölüm.',
      };
      s.ctx.refs.restore(rec);
    }
    const text = hits
      .map((_, i) => `Kararda "fazla çalışmanın tanıkla ispatı mümkündür" denir [K${i + 1}].`)
      .join('\n\n');
    const r = await check(s, text);
    expect(s.reads.length).toBe(max);
    expect(r.mismatched.size).toBe(max);
    expect(r.unchecked).toBe(1);
  });
});

describe('Alıntı denetimi: mevzuat', () => {
  it('getirilen madde metni tamdır: uyuşmazlık yeniden getirmesiz bildirilir', async () => {
    const s = setup([]);
    await getLegislationArticle(
      s.ctx,
      { ref: null, law_no: '6098', article_no: '352', as_of: null },
      'c1',
      signal,
    );
    const ok = await check(s, '"boşaltma tarihini yazılı olarak bildirmişse" [K1]');
    expect([...ok.mismatched]).toEqual([]);
    const bad = await check(s, '"boşaltma tarihini sözlü olarak bildirmişse" [K1]');
    expect([...bad.mismatched]).toEqual(['K1']);
    expect(s.reads).toEqual([]);
  });

  it('yalnız arama özeti görülen madde denetlenemez: durum değişmez', async () => {
    const s = setup([]);
    await searchLegislation(s.ctx, { query: 'tahliye taahhüdü', law_no: null }, 'c1', signal);
    const r = await check(s, '"boşaltma tarihini sözlü olarak bildirmişse" [K1]');
    expect([...r.mismatched]).toEqual([]);
    expect(r.unchecked).toBe(1);
  });
});
