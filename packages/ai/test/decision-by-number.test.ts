// @tk TK-28
// search_decisions numara ile erişim: boş sorgu yer tutucuyla gider, daire kapsam listesini daraltır,
// esas + karar eşleşmezse bir kez yalnız esas ile denenir ve not düşülür. [K#] üretimi değişmez.
// Numaralar uydurmadır.
import { scopeToRequest } from '@eda/contracts/scope';
import type { SearchDecisionsInput } from '@eda/contracts/tools';
import { describe, expect, it } from 'vitest';
import {
  type DecisionHit,
  MemoryRefStore,
  type SourceBackend,
  type ToolContext,
} from '../src/tools/context.ts';
import { newTurnBudget } from '../src/tools/execute.ts';
import { searchDecisions } from '../src/tools/handlers/decisions.ts';

type Query = Parameters<SourceBackend['searchDecisions']>[0];

const hit: DecisionHit = {
  source: 'bedesten',
  document_id: 'doc-5000',
  court_type: 'yargitay',
  court: 'Yargıtay',
  chamber: '3. Hukuk Dairesi',
  esas_no: '2022/5000',
  karar_no: '2023/100',
  decision_date: '2023-02-21',
  title: 'Örnek karar',
  snippet: 'Özet metni',
  url: 'https://example.invalid/5000',
  retrieved_at: '2026-10-11',
};

function setup(scope: Parameters<typeof scopeToRequest>[0], answer: (q: Query) => DecisionHit[]) {
  const calls: Query[] = [];
  const backend: SourceBackend = {
    async searchDecisions(q) {
      calls.push(q);
      return { results: answer(q), hasMore: false, stale: false };
    },
    async getDecision() {
      throw new Error('beklenmeyen çağrı');
    },
    async searchLegislation() {
      return { results: [] };
    },
    async getLegislationArticles() {
      throw new Error('beklenmeyen çağrı');
    },
  };
  const ctx: ToolContext = {
    backend,
    refs: new MemoryRefStore(),
    emit: () => {},
    budget: newTurnBudget(),
    turnRefs: new Set(),
    today: '2026-10-11',
    scope: scopeToRequest(scope),
  };
  return { ctx, calls };
}

const input = (over: Partial<SearchDecisionsInput>): SearchDecisionsInput => ({
  query: '',
  court_types: null,
  chamber: 'H3',
  date_from: null,
  date_to: null,
  esas_no: '2022/5000',
  karar_no: '2023/100',
  page: null,
  live: true,
  ...over,
});
const signal = new AbortController().signal;

describe('search_decisions: karar numarasıyla doğrudan erişim', () => {
  it('boş sorgu yer tutucuyla gider; esas/karar/daire aynen iletilir; sonuç [K1] alır', async () => {
    const s = setup(null, () => [hit]);
    const out = await searchDecisions(s.ctx, input({}), 'c1', signal);
    expect(s.calls).toEqual([
      expect.objectContaining({
        source: 'bedesten',
        query: 'karar',
        chamber: 'H3',
        esasNo: '2022/5000',
        kararNo: '2023/100',
        courtTypes: null,
      }),
    ]);
    expect(out.isError).toBe(false);
    expect(out.text).toContain('id="K1"');
    expect(s.ctx.refs.byRef('K1')?.shortKunye).toContain('2022/5000');
  });

  it('kapsamda Danıştay da seçiliyken daire kodu türleri Yargıtay ile sınırlar', async () => {
    const s = setup(['yargitay', 'danistay'], () => [hit]);
    await searchDecisions(s.ctx, input({ query: 'kira' }), 'c1', signal);
    expect(s.calls[0]?.courtTypes).toEqual(['yargitay']);
    expect(s.calls[0]?.query).toBe('kira');
  });

  it('daire kapsam dışındaysa kaynağa gidilmez', async () => {
    const s = setup(['danistay'], () => [hit]);
    const out = await searchDecisions(s.ctx, input({}), 'c1', signal);
    expect(s.calls).toEqual([]);
    expect(out.detail).toBe('kapsam dışı');
  });

  it('esas + karar eşleşmezse bir kez yalnız esas ile denenir ve tahmini eşleme notu düşülür', async () => {
    const s = setup(null, (q) => (q.kararNo === null ? [hit] : []));
    const out = await searchDecisions(s.ctx, input({ karar_no: '2023/999' }), 'c1', signal);
    expect(s.calls.map((c) => [c.esasNo, c.kararNo])).toEqual([
      ['2022/5000', '2023/999'],
      ['2022/5000', null],
    ]);
    expect(out.text).toContain('birlikte eşleşmedi');
    expect(out.text).toContain('id="K1"');
  });

  it('yalnız esas ile de bulunamazsa "sonuç yok" döner; ikinci deneme yapılmaz', async () => {
    const s = setup(null, () => []);
    const out = await searchDecisions(s.ctx, input({ karar_no: null }), 'c1', signal);
    expect(s.calls).toHaveLength(1);
    expect(out.text).toContain('Sonuç yok');
  });
});
