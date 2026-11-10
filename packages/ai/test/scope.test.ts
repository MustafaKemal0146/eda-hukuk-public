// P12 K5/K7: kullanıcının yargı kapsamı araç işleyicilerinde uygulanır; kapsam dışı çağrı kaynağa gitmez.
import { scopeToRequest } from '@eda/contracts/scope';
import type { SearchDecisionsInput } from '@eda/contracts/tools';
import { describe, expect, it } from 'vitest';
import { MemoryRefStore, type SourceBackend, type ToolContext } from '../src/tools/context.ts';
import { newTurnBudget } from '../src/tools/execute.ts';
import { searchDecisions } from '../src/tools/handlers/decisions.ts';
import { getLegislationArticle, searchLegislation } from '../src/tools/handlers/legislation.ts';

type DecisionQuery = Parameters<SourceBackend['searchDecisions']>[0];

function setup(ids: Parameters<typeof scopeToRequest>[0]) {
  const calls: DecisionQuery[] = [];
  let legislationCalls = 0;
  const backend: SourceBackend = {
    async searchDecisions(q) {
      calls.push(q);
      return { results: [], hasMore: false, stale: false };
    },
    async getDecision() {
      throw new Error('beklenmeyen çağrı');
    },
    async searchLegislation() {
      legislationCalls += 1;
      return { results: [] };
    },
    async getLegislationArticles() {
      legislationCalls += 1;
      throw new Error('beklenmeyen çağrı');
    },
  };
  const ctx: ToolContext = {
    backend,
    refs: new MemoryRefStore(),
    emit: () => {},
    budget: newTurnBudget(),
    turnRefs: new Set(),
    today: '2026-10-10',
    scope: scopeToRequest(ids),
  };
  return { ctx, calls, legislation: () => legislationCalls };
}

const input = (court_types: SearchDecisionsInput['court_types']): SearchDecisionsInput => ({
  query: 'kira tahliye taahhüdü',
  court_types,
  chamber: null,
  date_from: null,
  date_to: null,
  esas_no: null,
  karar_no: null,
  live: false,
  page: null,
});

const signal = new AbortController().signal;

describe('P12 K5/K7: kapsam araçlarda uygulanır', () => {
  it('otomatik kapsamda model türü yoksa Bedesten kısıtsız aranır', async () => {
    const s = setup(null);
    await searchDecisions(s.ctx, input(null), 'c1', signal);
    expect(s.calls).toEqual([expect.objectContaining({ source: 'bedesten', courtTypes: null })]);
  });

  it('yalnız Anayasa Mahkemesi seçiliyse çağrı anayasa kaynağına gider', async () => {
    const s = setup(['aym']);
    await searchDecisions(s.ctx, input(null), 'c1', signal);
    expect(s.calls).toEqual([
      expect.objectContaining({ source: 'anayasa', courtTypes: ['aym_bireysel', 'aym_norm'] }),
    ]);
  });

  it('kapsam dışı mahkeme türü istenirse kaynağa gidilmez ve canlı hak harcanmaz', async () => {
    const s = setup(['danistay', 'mevzuat']);
    const before = s.ctx.budget.liveSearches;
    const out = await searchDecisions(s.ctx, input(['yargitay']), 'c1', signal);
    expect(s.calls).toHaveLength(0);
    expect(out.text).toMatch(/kapsam/);
    expect(s.ctx.budget.liveSearches).toBe(before);
  });

  it('mevzuat kapsamda değilse mevzuat araçları kaynağa gitmez', async () => {
    const s = setup(['yargitay']);
    const a = await searchLegislation(s.ctx, { query: 'kira', law_no: null }, 'c1', signal);
    const b = await getLegislationArticle(
      s.ctx,
      { ref: null, law_no: '6098', article_no: '352', as_of: null },
      'c2',
      signal,
    );
    expect(s.legislation()).toBe(0);
    expect(a.text).toMatch(/kapsam/);
    expect(b.text).toMatch(/kapsam/);
  });
});

describe('081: künye tek biçimleyiciden', () => {
  it('AYM bireysel kısa stilde bölüm yazılmaz, tam stilde parantez içindedir', async () => {
    const { decisionLongKunye, decisionShortKunye } = await import('../src/tools/kunye.ts');
    const hit = {
      source: 'anayasa' as const,
      document_id: 'BB/2019/25823',
      court_type: 'aym_bireysel' as const,
      court: 'Anayasa Mahkemesi',
      chamber: 'İkinci Bölüm',
      esas_no: '2019/25823',
      karar_no: null,
      decision_date: '2022-03-30',
      title: 'Anayasa Mahkemesi',
      snippet: null,
      url: 'https://kararlarbilgibankasi.anayasa.gov.tr/BB/2019/25823',
      retrieved_at: '2026-10-10',
    };
    expect(decisionShortKunye(hit)).toBe('AYM B. No: 2019/25823');
    expect(decisionLongKunye(hit)).toBe(
      'Anayasa Mahkemesi (İkinci Bölüm), B. No: 2019/25823, T. 30.03.2022',
    );
  });
});

describe('#12: kanun numarasız ve sonuçsuz arama konuya göre kanunda yinelenir', () => {
  const hit = {
    law_no: '2918',
    law_name: 'KARAYOLLARI TRAFİK KANUNU',
    article_no: '74',
    title: 'Yayalara ilk geçiş hakkı verilmesi',
    snippet: null,
    url: 'https://example.invalid/2918/74',
    last_amended_at: null,
    retrieved_at: '2026-10-11',
  };
  function legSetup() {
    const calls: { query: string; lawNo: string | null }[] = [];
    const backend: SourceBackend = {
      async searchDecisions() {
        return { results: [], hasMore: false, stale: false };
      },
      async getDecision() {
        throw new Error('beklenmeyen çağrı');
      },
      async searchLegislation(q) {
        calls.push({ query: q.query, lawNo: q.lawNo ?? null });
        return { results: q.lawNo === '2918' ? [hit] : [] };
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
      scope: scopeToRequest(null),
    };
    return { ctx, calls };
  }
  const sig = new AbortController().signal;

  it('boş sonuçta konudan çıkarılan kanunda yeniden arar ve tahmini eşleme notu verir', async () => {
    const s = legSetup();
    const out = await searchLegislation(
      s.ctx,
      { query: 'yaya geçidi yayaya öncelik', law_no: null, include_repealed: false } as never,
      'c1',
      sig,
    );
    expect(s.calls.map((c) => c.lawNo)).toEqual([null, '2918']);
    expect(out.text).toContain('Yayalara ilk geçiş hakkı');
    expect(out.text).toContain('tahmini bir eşlemedir');
  });

  it('kanun numarası verilmişse yinelenmez', async () => {
    const s = legSetup();
    await searchLegislation(
      s.ctx,
      { query: 'yaya geçidi', law_no: '6098', include_repealed: false } as never,
      'c1',
      sig,
    );
    expect(s.calls).toHaveLength(1);
  });
});
