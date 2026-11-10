// Karar Arşivi ve Mevzuat uçları (P15.9, P16.6–P16.9;): sözleşme (Zod), hata eşleme
// (021 §6.4), arama kaydı ömrü, PII kapısı, canlı aramanın yalnız açık istekle çalışması ve sorgu gizliliği.
// Veri sentetiktir ("Örnek"); MCP yerine sahte kaynak kullanılır.
import {
  ArticleDto,
  DecisionDto,
  decodeLiveDecisionId,
  encodeLiveDecisionId,
  LawDto,
  LegislationSearchResultsDto,
  SearchResultsDto,
  SectionDto,
} from '@eda/contracts/api';
import type {
  McpErrorCode,
  McpGetDecisionResult,
  McpGetLegislationLiveResult,
  McpSearchDecisionsArgs,
  McpSearchDecisionsResult,
  NormalizedDecisionValue,
} from '@eda/contracts/mcp';
import { isValidTckn } from '@eda/kvkk';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { createAppSurface } from '../src/app.ts';
import { createReadiness } from '../src/health/ready.ts';
import { uuidv7 } from '../src/middleware/request-id.ts';
import { docketOf, liveQueryOf } from '../src/services/decisions/decisions.ts';
import { LiveQuota, SearchStore } from '../src/services/decisions/search-store.ts';
import { plainText, toLegislationHit } from '../src/services/legislation/legislation.ts';
import { buildResearchDeps } from '../src/services/research.ts';
import { retryAfterSec } from '../src/services/sources/errors.ts';
import { type LiveSource, LiveSourceError } from '../src/services/sources/live-source.ts';

const TODAY = '2026-10-10';

function hit(n: number, source = 'bedesten', date: string | null = null): NormalizedDecisionValue {
  return {
    source: source as NormalizedDecisionValue['source'],
    document_id: source === 'anayasa' ? `BB/2020/${n}` : String(1000000 + n),
    court_type: source === 'anayasa' ? 'aym_bireysel' : 'yargitay',
    court: source === 'anayasa' ? 'Anayasa Mahkemesi' : 'Yargıtay',
    chamber: source === 'anayasa' ? null : '3. Hukuk Dairesi',
    chamber_code: null,
    esas_no: `2024/${n}`,
    karar_no: `2025/${n}`,
    decision_date: date,
    title: `Örnek karar ${n}`,
    snippet: null,
    url: `https://mevzuat.adalet.gov.tr/ictihat/${1000000 + n}`,
    retrieved_at: TODAY,
    origin: 'live',
    facets: null,
  };
}

function page(
  source: McpSearchDecisionsArgs['source'],
  results: NormalizedDecisionValue[],
  hasMore = false,
): McpSearchDecisionsResult {
  return {
    source,
    page: 1,
    page_size: 10,
    total: null,
    has_more: hasMore,
    results,
    status: 'ok',
    cached: false,
    stale_as_of: null,
    warnings: [],
  };
}

const DOC: McpGetDecisionResult = {
  source: 'bedesten',
  document_id: '1000001',
  court_type: 'yargitay',
  court: 'Yargıtay',
  chamber: '3. Hukuk Dairesi',
  chamber_code: 'H3',
  esas_no: '2024/1',
  karar_no: '2025/1',
  decision_date: '2025-01-02',
  title: null,
  url: 'https://mevzuat.adalet.gov.tr/ictihat/1000001',
  retrieved_at: TODAY,
  mime_type: 'text/html',
  text_status: 'ok',
  total_sections: 2,
  total_chars: 40,
  content_sha256: null,
  sections: [
    { no: 1, role: 'kunye', chars: 20, markdown: 'Örnek künye bölümü.' },
    { no: 2, role: 'gerekce', chars: 20, markdown: 'Örnek **gerekçe** bölümü.' },
  ],
  cached: false,
  warnings: [],
};

function law(articles: McpGetLegislationLiveResult['articles']): McpGetLegislationLiveResult {
  return {
    law_no: '6098',
    law_type: 'kanun',
    law_name: 'Örnek Borçlar Kanunu',
    mevzuat_ref: '1.5.6098',
    url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098',
    retrieved_at: TODAY,
    last_amended_at: null,
    articles,
    total_chars: 10,
    cached: false,
    warnings: [],
  };
}

const art = (no: string, repealed = false) => ({
  article_no: no,
  heading: `Örnek başlık ${no}`,
  // yargi-mcp: `markdown` işaretçiden sonraki madde metnidir ("**Madde n –**" öneki yok).
  markdown: `(1) Örnek **fıkra**.\n\n(2) İkinci örnek fıkra.`,
  repealed,
});

type Script = {
  search?: (args: McpSearchDecisionsArgs) => McpSearchDecisionsResult;
};

function fakeSource(script: Script = {}) {
  const calls: { tool: string; args: unknown }[] = [];
  const fail = (code: McpErrorCode, ms: number | null = null, source = 'bedesten') => {
    throw new LiveSourceError(code, null, ms, source);
  };
  const state: {
    decision: () => McpGetDecisionResult;
    legislation: (args: {
      article_no: string;
      article_to: string | null;
    }) => McpGetLegislationLiveResult;
  } = {
    decision: () => DOC,
    legislation: () => law([art('1')]),
  };
  const source: LiveSource = {
    async searchDecisions(args) {
      calls.push({ tool: 'search_decisions', args });
      if (script.search) return script.search(args);
      if (args.source !== 'bedesten') return fail('SOURCE_NOT_IN_COVERAGE', null, args.source);
      return page('bedesten', [hit(1, 'bedesten', '2024-05-01'), hit(2, 'bedesten', '2025-03-01')]);
    },
    async getDecision(args) {
      calls.push({ tool: 'get_decision', args });
      return state.decision();
    },
    async searchLegislation(args) {
      calls.push({ tool: 'search_legislation_live', args });
      return {
        page: 1,
        page_size: 5,
        total: 2,
        has_more: false,
        results: [
          {
            source: 'mevzuat',
            law_no: '6098',
            law_type: 'kanun',
            law_name: 'Örnek Borçlar Kanunu',
            mevzuat_ref: '1.5.6098',
            article_no: '352',
            title: 'Örnek Borçlar Kanunu m. 352 — Örnek başlık',
            snippet: 'Örnek madde özeti',
            url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098',
            last_amended_at: null,
            retrieved_at: TODAY,
          },
          {
            source: 'mevzuat',
            law_no: '12345',
            law_type: 'teblig',
            law_name: 'Örnek Tebliğ',
            mevzuat_ref: '9.5.12345',
            article_no: null,
            title: 'Örnek Tebliğ',
            snippet: null,
            url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=12345',
            last_amended_at: null,
            retrieved_at: TODAY,
          },
        ],
        status: 'ok',
        cached: false,
        stale_as_of: null,
        warnings: [],
      };
    },
    async getLegislation(args) {
      calls.push({ tool: 'get_legislation_live', args });
      return state.legislation(args);
    },
  };
  return { source, calls, state, fail };
}

function surface(source: LiveSource, opts: { quota?: LiveQuota; logs?: string[] } = {}) {
  const logs = opts.logs ?? [];
  const logger = createLogger({
    service: 'eda-api-test',
    destination: { write: (s: string) => void logs.push(s) },
  });
  const ready = createReadiness({
    probes: [],
    cacheMs: 0,
    version: 'test',
    state: { draining: false },
  });
  return createAppSurface({
    surface: 'app',
    logger,
    state: { draining: false },
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 1024 * 1024,
    ready,
    research: buildResearchDeps(source, {
      uuid: () => uuidv7(),
      ...(opts.quota ? { quota: opts.quota } : {}),
    }),
  }).app;
}

const FILTERS = { courtTypes: null, chamberCodes: null, dateFrom: null, dateTo: null };

async function post(app: ReturnType<typeof surface>, path: string, body?: unknown) {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function newSearch(app: ReturnType<typeof surface>, query = 'kira tahliye taahhüdü') {
  const res = await post(app, '/api/v1/decisions/search', { query, filters: FILTERS });
  expect(res.status).toBe(201);
  return SearchResultsDto.parse(await res.json());
}

async function errorOf(res: Response) {
  const body = (await res.json()) as { error: { code: string; reason: string | null } };
  return body.error;
}

/** Sentetik, algoritmaca geçerli TCKN (yaygın test değeri; gerçek kişiye ait değildir). */
const SYNTHETIC_TCKN = '10000000146';

describe('KK-P16-2 arama kaydı ve sonuç sayfası', () => {
  it('POST search 201 SearchResultsDto; MCP çağrısı yok (KK-P16-6)', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    const dto = await newSearch(app);
    expect(dto.items).toEqual([]);
    expect(dto.live).toMatchObject({ available: true, requested: false, status: 'none' });
    expect(dto.localCorpus.available).toBe(false);
    expect(dto.liveReasons).toEqual(['few_local_results']);
    const got = await app.request(
      `/api/v1/decisions/searches/${dto.searchId}?page=1&sort=date_desc`,
    );
    expect(got.status).toBe(200);
    expect(got.headers.get('cache-control')).toBe('no-store');
    SearchResultsDto.parse(await got.json());
    expect(f.calls).toEqual([]);
  });

  it('bilinmeyen/biçimsiz searchId 404 VALIDATION_RESOURCE_NOT_FOUND (decision_search)', async () => {
    const app = surface(fakeSource().source);
    for (const id of [uuidv7(), 'abc']) {
      const res = await app.request(`/api/v1/decisions/searches/${id}`);
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toMatchObject({
        code: 'VALIDATION_RESOURCE_NOT_FOUND',
        reason: 'decision_search',
      });
    }
  });

  it('KK-P16-1 sorgu URL ile taşınamaz: `q` parametresi reddedilir', async () => {
    const app = surface(fakeSource().source);
    const dto = await newSearch(app);
    const res = await app.request(`/api/v1/decisions/searches/${dto.searchId}?q=kira`);
    expect(res.status).toBe(422);
    expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
  });

  it('KK-P16-3 doğrulama: kısa sorgu, tarih aralığı, dairesiz mahkeme, kanonik dışı tür', async () => {
    const app = surface(fakeSource().source);
    const bodies = [
      { query: 'a', filters: FILTERS },
      { query: 'kira', filters: { ...FILTERS, dateFrom: '2025-02-01', dateTo: '2025-01-01' } },
      { query: 'kira', filters: { ...FILTERS, chamberCodes: ['H3'] } },
      {
        query: 'kira',
        filters: { ...FILTERS, courtTypes: ['aym_norm'], chamberCodes: ['H3'] },
      },
      { query: 'kira', filters: { ...FILTERS, courtTypes: ['bam'] } },
    ];
    for (const body of bodies) {
      const res = await post(app, '/api/v1/decisions/search', body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect((await errorOf(res)).code).toBe('VALIDATION_FAILED');
    }
    const ok = await post(app, '/api/v1/decisions/search', {
      query: 'kira',
      filters: { ...FILTERS, courtTypes: ['yargitay'], chamberCodes: ['H3'] },
    });
    expect(ok.status).toBe(201);
  });
});

describe('KK-P16-8 PII kapısı', () => {
  it('sorguda TCKN: kayıt blocked_pii, canlı 422 SOURCE_PII_BLOCKED, MCP çağrısı yok', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    expect(isValidTckn(SYNTHETIC_TCKN)).toBe(true);
    const dto = await newSearch(app, `kira alacağı ${SYNTHETIC_TCKN}`);
    expect(dto.live.status).toBe('blocked_pii');
    expect(dto.liveReasons).toEqual([]);
    const res = await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`);
    expect(res.status).toBe(422);
    expect(await errorOf(res)).toMatchObject({
      code: 'SOURCE_PII_BLOCKED',
      reason: 'pii_detected',
    });
    expect(f.calls).toEqual([]);
  });
});

describe('KK-P16-7 canlı arama ve hata eşleme (021 §6.4)', () => {
  it('yalnız açık istekle; kaynak başı durum; ikinci istek portala gitmez', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    const dto = await newSearch(app);
    const res = await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`);
    expect(res.status).toBe(200);
    const live = SearchResultsDto.parse(await res.json());
    expect(live.live.status).toBe('done');
    expect(live.items).toHaveLength(2);
    const first = live.items[0];
    expect(first?.origin).toBe('live');
    expect(first?.shortKunye).toBe('Y. 3. HD 2024/1 E.');
    expect(decodeLiveDecisionId(first?.decisionId ?? '')).toEqual({
      source: 'bedesten',
      documentId: '1000001',
    });
    expect(Object.fromEntries(live.live.sources.map((s) => [s.source, s.status]))).toEqual({
      bedesten: 'done',
      anayasa: 'not_in_coverage',
    });
    // otomatik kapsamda Uyuşmazlık canlı aranmaz.
    expect(f.calls.some((c) => JSON.stringify(c).includes('uyusmazlik'))).toBe(false);
    const before = f.calls.length;
    const again = await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`, {});
    expect(again.status).toBe(200);
    expect(f.calls.length).toBe(before);
    // Sıralama yeni kayıt üretmez, sayfa içinde tarihe göre dizer.
    const sorted = SearchResultsDto.parse(
      await (await app.request(`/api/v1/decisions/searches/${dto.searchId}?sort=date_desc`)).json(),
    );
    expect(sorted.searchId).toBe(dto.searchId);
    expect(sorted.items.map((i) => i.decisionDate)).toEqual(['2025-03-01', '2024-05-01']);
  });

  it('kapsam yalnız Yargıtay: tek kaynak çağrılır, daire ve mahkeme türü geçer', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    const res = await post(app, '/api/v1/decisions/search', {
      query: '2024/1 E. tahliye',
      filters: { ...FILTERS, courtTypes: ['yargitay'], chamberCodes: ['H3'] },
    });
    const dto = SearchResultsDto.parse(await res.json());
    await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.args).toMatchObject({
      source: 'bedesten',
      court_types: ['yargitay'],
      chamber: 'H3',
      esas_no: '2024/1',
      page_size: 10,
    });
  });

  it('tüm kaynaklar yoğun: 503 SOURCE_BUSY + Retry-After', async () => {
    const f = fakeSource({
      search: (a) => {
        throw new LiveSourceError('SOURCE_BUSY', 'queue_wait_exceeded', 4200, a.source);
      },
    });
    const app = surface(f.source);
    const dto = await newSearch(app);
    const res = await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
    expect(await errorOf(res)).toMatchObject({
      code: 'SOURCE_BUSY',
      reason: 'queue_wait_exceeded',
    });
    const after = SearchResultsDto.parse(
      await (await app.request(`/api/v1/decisions/searches/${dto.searchId}`)).json(),
    );
    expect(after.live.status).toBe('busy');
    expect(after.live.requested).toBe(false);
  });

  it('hız sınırı 429, erişilemez 503, yalnız kapsam dışı 422 ("sonuç yok" değil)', async () => {
    const cases: [McpErrorCode, number][] = [
      ['SOURCE_RATE_LIMITED', 429],
      ['SOURCE_UNAVAILABLE', 503],
      ['SOURCE_NOT_IN_COVERAGE', 422],
    ];
    for (const [code, status] of cases) {
      const f = fakeSource({
        search: (a) => {
          throw new LiveSourceError(code, null, null, a.source);
        },
      });
      const app = surface(f.source);
      const dto = await newSearch(app);
      const res = await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`);
      expect(res.status, code).toBe(status);
      expect((await errorOf(res)).code).toBe(code);
      if (status !== 422) expect(res.headers.get('retry-after')).toBe('30');
    }
  });

  it('kullanıcı kovası (sources.userLivePerMin): dördüncü istek 429 user_live_quota', async () => {
    const app = surface(fakeSource().source, { quota: new LiveQuota(3) });
    for (let i = 0; i < 3; i++) {
      const dto = await newSearch(app);
      expect((await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`)).status).toBe(200);
    }
    const dto = await newSearch(app);
    const res = await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`);
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toMatchObject({
      code: 'SOURCE_RATE_LIMITED',
      reason: 'user_live_quota',
    });
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('`more` yalnız sonraki sayfası olan kaynağa gider ve sonuçları ekler', async () => {
    const f = fakeSource({
      search: (a) => {
        if (a.source !== 'bedesten') throw new LiveSourceError('SOURCE_NOT_IN_COVERAGE');
        const results = Array.from({ length: 10 }, (_, i) => hit((a.page - 1) * 10 + i + 1));
        return { ...page('bedesten', results, a.page < 2), page: a.page };
      },
    });
    const app = surface(f.source);
    const dto = await newSearch(app, 'tahliye');
    const one = SearchResultsDto.parse(
      await (await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`)).json(),
    );
    expect(one.live.hasMore).toBe(true);
    const two = SearchResultsDto.parse(
      await (
        await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`, { more: true })
      ).json(),
    );
    expect(two.pagination.total).toBe(20);
    expect(two.live.hasMore).toBe(false);
    const bedestenCalls = f.calls.filter(
      (c) => (c.args as McpSearchDecisionsArgs).source === 'bedesten',
    );
    expect(bedestenCalls.map((c) => (c.args as McpSearchDecisionsArgs).page)).toEqual([1, 2]);
  });

  it('TK-05 sorgu metni log satırlarına yazılmaz', async () => {
    const logs: string[] = [];
    const f = fakeSource({
      search: () => {
        throw new LiveSourceError('SOURCE_UNAVAILABLE', 'network');
      },
    });
    const app = surface(f.source, { logs });
    const marker = 'Örnekişaretzxq kira';
    const dto = await newSearch(app, marker);
    await post(app, `/api/v1/decisions/searches/${dto.searchId}/live`);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('Örnekişaretzxq');
  });
});

describe('KK-P16-19 karar ve bölüm okuma', () => {
  const id = encodeLiveDecisionId('bedesten', '1000001');

  it('DecisionDto + SectionDto; bölümler tek MCP çağrısından', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    const res = await app.request(`/api/v1/decisions/${id}`);
    expect(res.status).toBe(200);
    const dto = DecisionDto.parse(await res.json());
    expect(dto.shortKunye).toBe('Y. 3. HD 2024/1 E.');
    expect(dto.fullKunye).toBe('Yargıtay 3. Hukuk Dairesi, E. 2024/1, K. 2025/1, T. 02.01.2025');
    expect(dto.sections.map((s) => s.role)).toEqual(['kunye', 'gerekce']);
    const sec = SectionDto.parse(
      await (await app.request(`/api/v1/decisions/${id}/sections/2`)).json(),
    );
    expect(sec.text).toContain('gerekçe');
    expect(f.calls.filter((c) => c.tool === 'get_decision')).toHaveLength(1);
    expect((await app.request(`/api/v1/decisions/${id}/sections/9`)).status).toBe(404);
  });

  it('belge yok 404 SOURCE_DOCUMENT_NOT_FOUND; yerel kimlik 404 decision; yoğun 503', async () => {
    const f = fakeSource();
    f.state.decision = () => f.fail('SOURCE_DOCUMENT_NOT_FOUND');
    const app = surface(f.source);
    const nf = await app.request(`/api/v1/decisions/${id}`);
    expect(nf.status).toBe(404);
    expect((await errorOf(nf)).code).toBe('SOURCE_DOCUMENT_NOT_FOUND');
    const local = await app.request(`/api/v1/decisions/${uuidv7()}`);
    expect(await errorOf(local)).toMatchObject({
      code: 'VALIDATION_RESOURCE_NOT_FOUND',
      reason: 'decision',
    });
    f.state.decision = () => f.fail('SOURCE_BUSY', 2000);
    const busy = await app.request(`/api/v1/decisions/${encodeLiveDecisionId('bedesten', '7')}`);
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('2');
  });
});

describe('KK-P15-9 mevzuat uçları (canlı köken)', () => {
  it('arama: kanonik dışı tür (tebliğ) atılır, madde URL biçiminde, kısa ad 003 §5', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    const res = await post(app, '/api/v1/legislation/search', {
      query: 'kiracı tahliye',
      lawNo: null,
      lawType: null,
      includeRepealed: false,
    });
    expect(res.status).toBe(200);
    const dto = LegislationSearchResultsDto.parse(await res.json());
    expect(dto.items).toHaveLength(1);
    expect(dto.items[0]).toMatchObject({
      lawNo: '6098',
      shortName: 'TBK',
      articleNo: '352',
      articleTitle: 'Örnek başlık',
      origin: 'live',
      relevance: null,
    });
  });

  it('kanun: madde 1 penceresiyle; madde dizini hazır değil (articleCount 0)', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    const dto = LawDto.parse(await (await app.request('/api/v1/legislation/laws/6098')).json());
    expect(dto).toMatchObject({ lawNo: '6098', lawType: 'law', origin: 'live', articleCount: 0 });
    expect(f.calls[0]?.args).toMatchObject({ law_no: '6098', article_no: '1', article_to: null });
  });

  it('madde: tek çağrıda komşular; düz metin; harfli madde URL biçimi', async () => {
    const f = fakeSource();
    f.state.legislation = () => law([art('48'), art('49'), art('49/A'), art('50')]);
    const app = surface(f.source);
    const a = ArticleDto.parse(
      await (await app.request('/api/v1/legislation/laws/6098/articles/49-A')).json(),
    );
    expect(a).toMatchObject({ articleNo: '49-A', prevArticleNo: '49', nextArticleNo: '50' });
    expect(a.text).toBe('(1) Örnek fıkra.\n\n(2) İkinci örnek fıkra.');
    expect(f.calls[0]?.args).toMatchObject({ article_no: '48', article_to: '50' });
    const tarihli = ArticleDto.parse(
      await (await app.request('/api/v1/legislation/laws/6098/articles/49?asOf=2020-01-01')).json(),
    );
    expect(tarihli).toMatchObject({ asOf: '2020-01-01', asOfUnverified: true });
  });

  it('AS-0349 regresyon: yargi-mcp G/E/M anahtarı; komşular aynı türde, URL biçimi korunur', async () => {
    const f = fakeSource();
    f.state.legislation = () => law([art('G4'), art('G5'), art('G6')]);
    const app = surface(f.source);
    const g = ArticleDto.parse(
      await (await app.request('/api/v1/legislation/laws/6098/articles/G5')).json(),
    );
    expect(g).toMatchObject({ articleNo: 'G5', prevArticleNo: 'G4', nextArticleNo: 'G6' });
    expect(g.text.startsWith('(1)')).toBe(true);
    expect(f.calls[0]?.args).toMatchObject({ article_no: 'G4', article_to: 'G6' });

    f.state.legislation = () => law([art('E1'), art('E2')]);
    const e = ArticleDto.parse(
      await (await app.request('/api/v1/legislation/laws/6098/articles/E1')).json(),
    );
    expect(e).toMatchObject({ articleNo: 'E1', prevArticleNo: null, nextArticleNo: 'E2' });
    expect(f.calls[1]?.args).toMatchObject({ article_no: 'E1', article_to: 'E2' });

    f.state.legislation = () => law([art('M17'), art('M18')]);
    const m = ArticleDto.parse(
      await (await app.request('/api/v1/legislation/laws/6098/articles/M18')).json(),
    );
    expect(m).toMatchObject({ articleNo: 'M18', prevArticleNo: 'M17', nextArticleNo: null });
    expect(f.calls[2]?.args).toMatchObject({ article_no: 'M17', article_to: 'M19' });
  });

  it('AS-0349 regresyon: arama sonucundaki G1 anahtarı URL biçiminde döner', () => {
    const base = {
      source: 'mevzuat' as const,
      law_no: '6098',
      law_type: 'kanun' as const,
      law_name: 'Örnek Borçlar Kanunu',
      mevzuat_ref: '1.5.6098',
      article_no: 'G1',
      title: 'Örnek Borçlar Kanunu geçici m. 1 — Örnek geçiş başlığı',
      snippet: null,
      url: 'https://www.mevzuat.gov.tr/mevzuat?MevzuatNo=6098',
      last_amended_at: null,
      retrieved_at: TODAY,
    };
    expect(toLegislationHit(base)).toMatchObject({
      articleNo: 'G1',
      articleTitle: 'Örnek geçiş başlığı',
    });
    expect(toLegislationHit({ ...base, article_no: '352/A' })?.articleNo).toBe('352-A');
  });

  it('KK-P15-10 bulunamadı ≠ ulaşılamadı; geçersiz parametreler MCP çağırmaz', async () => {
    const f = fakeSource();
    const app = surface(f.source);
    f.state.legislation = () => f.fail('SOURCE_DOCUMENT_NOT_FOUND', null, 'mevzuat');
    const nf = await app.request('/api/v1/legislation/laws/6098/articles/999');
    expect(nf.status).toBe(404);
    expect(await errorOf(nf)).toMatchObject({
      code: 'VALIDATION_RESOURCE_NOT_FOUND',
      reason: 'article',
    });
    f.state.legislation = () => f.fail('SOURCE_UNAVAILABLE', null, 'mevzuat');
    const down = await app.request('/api/v1/legislation/laws/6098/articles/1');
    expect(down.status).toBe(503);
    expect((await errorOf(down)).code).toBe('SOURCE_UNAVAILABLE');
    const before = f.calls.length;
    for (const path of ['laws/12a', 'laws/6098/articles/M18-A', 'laws/6098/articles/49%2FA']) {
      expect((await app.request(`/api/v1/legislation/${path}`)).status, path).toBe(404);
    }
    expect(f.calls.length).toBe(before);
  });
});

describe('AS-0065 yüzey yalnız development/test', () => {
  it('araştırma bağımlılığı verilmezse uçlar kayıtsızdır (404)', async () => {
    const logger = createLogger({ service: 'eda-api-test', destination: { write: () => {} } });
    const app = createAppSurface({
      surface: 'app',
      logger,
      state: { draining: false },
      maintenanceMode: () => false,
      jsonBodyMaxBytes: 1024,
      ready: createReadiness({ probes: [], cacheMs: 0, version: 't', state: { draining: false } }),
    }).app;
    const res = await post(app, '/api/v1/decisions/search', { query: 'kira', filters: FILTERS });
    expect(res.status).toBe(404);
  });
});

describe('yardımcılar', () => {
  it('Retry-After saniyesi yukarı yuvarlanır ve sınırlanır', () => {
    expect(retryAfterSec(4200)).toBe(5);
    expect(retryAfterSec(null)).toBe(30);
    expect(retryAfterSec(10 * 60_000)).toBe(60);
  });

  it('esas/karar numarası ve 300 karakter sınırı', () => {
    expect(docketOf('kira 2024/123 E. 2025/45 K.')).toEqual({ esas: '2024/123', karar: '2025/45' });
    expect(docketOf('K. 2025/9')).toEqual({ esas: null, karar: '2025/9' });
    const long = liveQueryOf(`${'kelime '.repeat(80)}son`);
    expect(long.length).toBeLessThanOrEqual(300);
    expect(long.endsWith('kelime')).toBe(true);
  });

  it('arama kaydı ömrü dolunca yok sayılır; üst sınırda en eski düşer', () => {
    const store = new SearchStore(2);
    const mk = (id: string, expiresAt: number) => ({
      id,
      query: 'q',
      filters: FILTERS,
      piiFlag: false,
      liveSources: [],
      createdAt: 0,
      expiresAt,
      live: {
        requested: false,
        status: 'none' as const,
        staleAsOf: null,
        inFlight: false,
        sources: new Map(),
        hits: [],
      },
    });
    store.add(mk('a', 100), 0);
    store.add(mk('b', 100), 0);
    store.add(mk('c', 100), 0);
    expect(store.get('a', 0)).toBeUndefined();
    expect(store.get('b', 99)?.id).toBe('b');
    expect(store.get('b', 100)).toBeUndefined();
  });

  it('madde Markdown → düz metin', () => {
    expect(plainText('## Başlık\n**MADDE 1-** (1) Metin\\.\n\n\n\nSon')).toBe(
      'Başlık\nMADDE 1- (1) Metin.\n\nSon',
    );
  });
});
