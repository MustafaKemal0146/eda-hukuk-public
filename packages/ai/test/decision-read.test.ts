// #59 / #12: arama sonucundaki ilk kararların metni sunucuda okunur (model "okunmadı" demek yerine
// bulguyu anlatabilsin); "hak doldu" notu modelin araç hakkını tüketmez.
import { scopeToRequest } from '@eda/contracts/scope';
import type { SearchDecisionsInput } from '@eda/contracts/tools';
import { describe, expect, it } from 'vitest';
import {
  type DecisionDoc,
  type DecisionHit,
  MemoryRefStore,
  type SourceBackend,
  SourceError,
  type ToolContext,
} from '../src/tools/context.ts';
import { newTurnBudget } from '../src/tools/execute.ts';
import { searchDecisions } from '../src/tools/handlers/decisions.ts';

const hit = (n: number, snippet: string | null = null): DecisionHit => ({
  source: 'bedesten',
  document_id: `doc-${n}`,
  court_type: 'yargitay',
  court: 'Yargıtay',
  chamber: '12. Ceza Dairesi',
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
    { no: 1, role: 'kunye', chars: 40, markdown: 'Künye bloğu' },
    {
      no: 2,
      role: 'gerekce',
      chars: 90,
      markdown: 'Sanığın eylemi\n\nsabit görülmüştür; gerekçe burada.',
    },
    { no: 3, role: 'hukum', chars: 60, markdown: 'Hükmün bozulmasına karar verildi.' },
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
      if (opts.failRead) throw new SourceError('SOURCE_BUSY');
      const h = hits.find((x) => x.document_id === id);
      if (!h) throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND');
      return doc(h);
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
    scope: scopeToRequest(null),
  };
  return { ctx, reads };
}

const input: SearchDecisionsInput = {
  query: 'sarhoşluk cinsel saldırı',
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

describe('#59: arama sonucundaki ilk kararlar sunucuda okunur', () => {
  it('ilk iki kararın hüküm ve gerekçe özütü metne girer; model çağrı hakkı harcanmaz', async () => {
    const s = setup([hit(1), hit(2), hit(3)]);
    const calls = s.ctx.budget.calls;
    const out = await searchDecisions(s.ctx, input, 'c1', signal);
    expect(s.reads).toEqual(['doc-1', 'doc-2']);
    expect(out.text).toContain('Okunan metinden');
    expect(out.text).toContain('Hüküm: Hükmün bozulmasına karar verildi.');
    expect(out.text).toContain('Gerekçe (başı): Sanığın eylemi sabit görülmüştür');
    expect(out.text).toContain('2 kararın metni okundu');
    // Üçüncü karar okunmadı: yönlendirme metni kalır.
    expect(out.text).toContain('Özet yok; metin için get_decision');
    expect(s.ctx.budget.calls).toBe(calls);
  });

  it('okunan karar kayda excerpt yazar; okunmayan künyeyle kalır (#58)', async () => {
    const s = setup([hit(1), hit(2), hit(3)]);
    await searchDecisions(s.ctx, input, 'c1', signal);
    expect(s.ctx.refs.byRef('K1')?.excerpt).toContain('Hüküm: Hükmün bozulmasına karar verildi.');
    expect(s.ctx.refs.byRef('K2')?.excerpt).toBeDefined();
    expect(s.ctx.refs.byRef('K3')?.excerpt).toBeUndefined();
  });

  it('özeti hazır gelen karar yeniden okunmaz', async () => {
    const s = setup([hit(1, 'Kaynaktan gelen özet'), hit(2), hit(3)]);
    await searchDecisions(s.ctx, input, 'c1', signal);
    expect(s.reads).toEqual(['doc-2', 'doc-3']);
  });

  it('okuma başarısız olursa arama sonucu künyeli liste olarak yine döner', async () => {
    const s = setup([hit(1), hit(2)], { failRead: true });
    const out = await searchDecisions(s.ctx, input, 'c1', signal);
    expect(out.isError).toBe(false);
    expect(out.text).not.toContain('Okunan metinden');
    expect(out.text).toContain('Özet yok; metin için get_decision');
  });
});

describe('#12: canlı arama hakkı dolunca çağrı hakkı iade edilir', () => {
  it('ikinci karar araması işaretli hak notu döndürür ve kaynağa gitmez', async () => {
    const s = setup([hit(1)]);
    s.ctx.budget.liveSearches = 0;
    const out = await searchDecisions(s.ctx, input, 'c2', signal);
    expect(out.refundCall).toBe(true);
    expect(out.text).toContain('canlı arama hakkı kullanıldı');
    expect(s.reads).toEqual([]);
  });
});
