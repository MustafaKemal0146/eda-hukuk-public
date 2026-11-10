// Karar Arşivi ve Mevzuat ekran yardımcıları (P15.10, P16.13;): URL durumu (sorgu
// URL'de yok), omnibox sınıflandırması, süzgeç kurulumu, canlı arama durum eşlemesi, istek istemcisi
// (Retry-After, şema doğrulaması) ve güvenli metin render'ı.
import { SearchResultsDto, type SearchResultsDtoValue } from '@eda/contracts/api';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { liveBannerOf, liveErrorKey, sourceStatusKey } from '../src/features/decisions/live-ui.ts';
import {
  cachedResults,
  forgetSearch,
  rememberResults,
} from '../src/features/decisions/search-cache.ts';
import { buildFilters, chamberGroupOf } from '../src/features/decisions/search-form.tsx';
import { inlineNodes, paragraphsOf } from '../src/features/decisions/section-text.tsx';
import {
  pageFromParams,
  sectionFromParams,
  serpHref,
  sortFromParams,
} from '../src/features/decisions/url-state.ts';
import { articleCopyText, asOfFromParam } from '../src/features/legislation/article-view.tsx';
import { legislationErrorKey } from '../src/features/legislation/errors.ts';
import { featuredLaws } from '../src/features/legislation/featured-laws.ts';
import {
  articleHref,
  articleUrlFromInput,
  classifyOmnibox,
  lawHref,
} from '../src/features/legislation/omnibox.ts';
import {
  getSearchPage,
  requestLiveSearch,
  researchErrorOf,
  searchDecisions,
} from '../src/lib/research-api.ts';

const TODAY = '2026-10-10';

function dto(over: Partial<SearchResultsDtoValue> = {}): SearchResultsDtoValue {
  return SearchResultsDto.parse({
    searchId: '019a0f3e-7c11-7a52-9d9b-2f0c6d1b8a10',
    query: 'Örnek sorgu',
    filters: { courtTypes: null, chamberCodes: null, dateFrom: null, dateTo: null },
    items: [],
    nextCursor: null,
    empty: true,
    degraded: false,
    liveReasons: ['few_local_results'],
    live: {
      available: true,
      requested: false,
      status: 'none',
      staleAsOf: null,
      sources: [],
      hasMore: false,
    },
    localCorpus: { available: false },
    overview: { status: 'none', text: null, generatedAt: null, badge: null, sources: [] },
    rerank: { available: false, status: 'none' },
    pagination: { page: 1, pageSize: 20, pageCount: 0, total: 0 },
    sort: 'relevance',
    expiresAt: '2026-10-11T08:00:00.000Z',
    createdAt: '2026-10-10T08:00:00.000Z',
    ...over,
  });
}

const params = (q: string) => new URLSearchParams(q);

describe('KK-P16-1 URL durumu: yalnız sayfa, sıralama, bölüm', () => {
  it('serpHref sorgu ve süzgeç taşımaz; varsayılanlar yazılmaz', () => {
    expect(serpHref('abc', 1, 'relevance')).toBe('/karar-arsivi/ara/abc');
    expect(serpHref('abc', 3, 'date_desc')).toBe('/karar-arsivi/ara/abc?sayfa=3&siralama=yeni');
  });

  it('geçersiz parametreler varsayılana düşer', () => {
    expect(pageFromParams(params('sayfa=0'))).toBe(1);
    expect(pageFromParams(params('sayfa=999'))).toBe(10);
    expect(pageFromParams(params('sayfa=2'))).toBe(2);
    expect(sortFromParams(params('siralama=eski'))).toBe('date_asc');
    expect(sortFromParams(params('siralama=x'))).toBe('relevance');
    expect(sectionFromParams(params('bolum=3'))).toBe(3);
    expect(sectionFromParams(params('bolum=-1'))).toBeNull();
  });
});

describe('KK-P16-3 süzgeç kurulumu (kanonik courtTypes, daire kuralı)', () => {
  it('otomatik kapsam: kısıt yok; daire yok sayılır', () => {
    expect(buildFilters(null, 'H3', '', '')).toEqual({
      courtTypes: null,
      chamberCodes: null,
      dateFrom: null,
      dateTo: null,
    });
  });

  it('yalnız Yargıtay: daire geçer; Danıştay dairesi Yargıtay kapsamında geçmez', () => {
    expect(buildFilters(['yargitay'], 'H3', '2024-01-01', '')).toEqual({
      courtTypes: ['yargitay'],
      chamberCodes: ['H3'],
      dateFrom: '2024-01-01',
      dateTo: null,
    });
    expect(buildFilters(['yargitay'], 'D5', '', '').chamberCodes).toBeNull();
    expect(buildFilters(['yargitay', 'aym'], 'H3', '', '').chamberCodes).toBeNull();
  });

  it('yalnız mevzuat seçimi karar aramasında kısıt üretmez', () => {
    expect(buildFilters(['mevzuat'], '', '', '').courtTypes).toBeNull();
    expect(chamberGroupOf(['danistay'])).toBe('danistay');
    expect(chamberGroupOf(['yargitay', 'kyb'])).toBe('yargitay');
    expect(chamberGroupOf(['yargitay', 'danistay'])).toBeNull();
  });
});

describe('KK-P16-7 canlı arama durum matrisi', () => {
  it('canlı otomatik değil; yerel korpus yokken düğme birincil', () => {
    expect(liveBannerOf(dto())).toEqual({ kind: 'cta', primary: true });
    expect(liveBannerOf(dto({ live: { ...dto().live, status: 'blocked_pii' } }))).toEqual({
      kind: 'blocked_pii',
    });
    expect(liveBannerOf(dto({ live: { ...dto().live, available: false } }))).toEqual({
      kind: 'none',
    });
  });

  it('hata kodları ve kaynak durumları; kapsam dışı "sonuç yok" değildir', () => {
    expect(liveErrorKey('SOURCE_BUSY')).toBe('busy');
    expect(liveErrorKey('SOURCE_RATE_LIMITED')).toBe('rateLimited');
    expect(liveErrorKey('SOURCE_PII_BLOCKED')).toBe('pii');
    expect(liveErrorKey('VALIDATION_RESOURCE_NOT_FOUND')).toBe('expired');
    const base = {
      source: 'anayasa' as const,
      retryAfterSec: null,
      resultCount: 0,
      hasMore: false,
    };
    expect(sourceStatusKey({ ...base, status: 'not_in_coverage' })).toBe('notInCoverage');
    expect(sourceStatusKey({ ...base, status: 'rate_limited' })).toBe('busy');
  });
});

describe('arama önbelleği (bellek içi, sorgusuz anahtar)', () => {
  it('ilk sayfa kaydedilir ve canlı sonrası unutulur', () => {
    const d = dto();
    rememberResults(d);
    expect(cachedResults(d.searchId, 1, 'relevance')).toBe(d);
    forgetSearch(d.searchId);
    expect(cachedResults(d.searchId, 1, 'relevance')).toBeUndefined();
  });
});

describe('KK-P16-1 istek istemcisi: sorgu yalnız gövdede', () => {
  function fake(status: number, body: unknown, headers: Record<string, string> = {}) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status, headers });
    }) as typeof fetch;
    return { fetcher, calls };
  }

  it('POST gövdesi sorguyu taşır; sayfa GET adresinde sorgu yok', async () => {
    const f = fake(201, dto());
    await searchDecisions(
      {
        query: 'Örnek gizli sorgu',
        filters: { courtTypes: null, chamberCodes: null, dateFrom: null, dateTo: null },
      },
      f.fetcher,
    );
    expect(f.calls[0]?.url).toBe('/api/v1/decisions/search');
    expect(String(f.calls[0]?.init?.body)).toContain('Örnek gizli sorgu');
    const g = fake(200, dto());
    await getSearchPage(
      '019a0f3e-7c11-7a52-9d9b-2f0c6d1b8a10',
      { page: 2, sort: 'date_asc' },
      g.fetcher,
    );
    expect(g.calls[0]?.url).toBe(
      '/api/v1/decisions/searches/019a0f3e-7c11-7a52-9d9b-2f0c6d1b8a10?page=2&sort=date_asc',
    );
  });

  it('503 SOURCE_BUSY: Retry-After ve kaynak taşınır', async () => {
    const f = fake(
      503,
      {
        error: {
          code: 'SOURCE_BUSY',
          message: 'Kaynak yoğun.',
          reason: 'queue_wait_exceeded',
          actions: [],
          meta: { source: 'bedesten', retryAfterSec: 5 },
          requestId: 'r1',
        },
      },
      { 'retry-after': '5' },
    );
    const err = await requestLiveSearch('x', false, f.fetcher).catch((e: unknown) => e);
    expect(researchErrorOf(err)).toMatchObject({
      code: 'SOURCE_BUSY',
      reason: 'queue_wait_exceeded',
      retryAfterSec: 5,
      source: 'bedesten',
      status: 503,
    });
  });

  it('şemaya uymayan yanıt CLIENT_INVALID_RESPONSE', async () => {
    const f = fake(200, { searchId: 'x' });
    const err = await getSearchPage('x', { page: 1, sort: 'relevance' }, f.fetcher).catch(
      (e: unknown) => e,
    );
    expect(researchErrorOf(err).code).toBe('CLIENT_INVALID_RESPONSE');
  });
});

describe('KK-P15-13 omnibox: atıf ve numara ağ araması olmadan çözülür', () => {
  it('madde atıfları', () => {
    expect(classifyOmnibox('TBK m. 49', TODAY)).toEqual({
      kind: 'article',
      lawNo: '6098',
      articleNo: '49',
    });
    expect(classifyOmnibox('TTK geçici m. 5', TODAY)).toMatchObject({ articleNo: 'G5' });
    expect(classifyOmnibox('6098 sayılı Kanun m. 352', TODAY)).toMatchObject({
      lawNo: '6098',
      articleNo: '352',
    });
    expect(classifyOmnibox('AY m. 36', TODAY)).toMatchObject({ lawNo: '2709' });
  });

  it('kanun numarası ve kısaltma kanun sayfasına; diğerleri arama', () => {
    expect(classifyOmnibox('6098', TODAY)).toEqual({ kind: 'law', lawNo: '6098' });
    expect(classifyOmnibox('4857 sayılı', TODAY)).toEqual({ kind: 'law', lawNo: '4857' });
    expect(classifyOmnibox('TBK', TODAY)).toEqual({ kind: 'law', lawNo: '6098' });
    expect(classifyOmnibox('kıdem tazminatı', TODAY)).toEqual({ kind: 'search' });
    expect(classifyOmnibox('TBK m. 49 kapsamında tazminat', TODAY)).toEqual({ kind: 'search' });
    expect(classifyOmnibox('49', TODAY)).toEqual({ kind: 'search' });
  });

  it('madde numarası girişi ve adresler', () => {
    expect(articleUrlFromInput('49/a')).toBe('49-A');
    expect(articleUrlFromInput('49/i')).toBe('49-I');
    expect(articleUrlFromInput('geçici 5')).toBe('G5');
    expect(articleUrlFromInput('Ek madde 3')).toBe('E3');
    expect(articleUrlFromInput('18 mükerrer')).toBe('M18');
    expect(articleUrlFromInput('m. 352')).toBe('352');
    expect(articleUrlFromInput('madde')).toBeNull();
    expect(lawHref('6098')).toBe('/mevzuat/6098');
    expect(articleHref('3', '1', 'regulation')).toBe('/mevzuat/3/1?tur=yonetmelik');
  });

  it('sık kullanılan kanunlar yalnız numara; etiket sözlükten', () => {
    const list = featuredLaws();
    expect(list.find((l) => l.lawNo === '6098')?.abbr).toBe('TBK');
    expect(list.every((l) => /^\d+$/.test(l.lawNo))).toBe(true);
  });
});

describe('KK-P15-16 madde sayfası yardımcıları', () => {
  it('tarih parametresi yalnız geçerli takvim günü', () => {
    expect(asOfFromParam('2024-02-29')).toEqual({ asOf: '2024-02-29', invalid: false });
    expect(asOfFromParam('2023-02-29')).toEqual({ asOf: null, invalid: true });
    expect(asOfFromParam(null)).toEqual({ asOf: null, invalid: false });
  });

  it('metin kopyalama biçimi; erişim tarihi yoksa kaynak satırı çıkar', () => {
    const a = {
      lawNo: '6098',
      lawType: 'law' as const,
      lawTitle: 'Örnek Kanun',
      shortName: 'TBK',
      articleNo: '352',
      title: 'Örnek başlık',
      text: '(1) Örnek fıkra.',
      status: 'in_force' as const,
      amendedNote: null,
      lastAmendedDate: null,
      asOf: null,
      asOfUnverified: false,
      origin: 'live' as const,
      retrievedAt: null,
      prevArticleNo: null,
      nextArticleNo: null,
      sourceUrl: null,
      warnings: [],
    };
    expect(articleCopyText(a, null, 'Mülga')).toBe('TBK m. 352 — Örnek başlık\n(1) Örnek fıkra.');
    expect(articleCopyText({ ...a, status: 'repealed' }, 'Kaynak: x', 'Mülga')).toBe(
      '(Mülga) TBK m. 352 — Örnek başlık\n(1) Örnek fıkra.\n\nKaynak: x',
    );
  });

  it('kaynak hatası "bulunamadı"ya dönüşmez', () => {
    const info = {
      message: null,
      requestId: null,
      status: 503,
      reason: null,
      retryAfterSec: 5,
      source: 'mevzuat',
    };
    expect(legislationErrorKey({ ...info, code: 'SOURCE_UNAVAILABLE' })).toBe('unavailable');
    expect(legislationErrorKey({ ...info, code: 'SOURCE_BUSY' })).toBe('busy');
    expect(legislationErrorKey({ ...info, code: 'VALIDATION_RESOURCE_NOT_FOUND' })).toBe(
      'notFound',
    );
  });
});

describe('TK-13 karar metni güvenli render (ham HTML yok)', () => {
  it('HTML etiketi düz metin kalır; yalnız **kalın** strong olur', () => {
    const html = renderToStaticMarkup(
      inlineNodes('Örnek <script>alert(1)</script> **önemli** metin'),
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('<strong class="font-semibold">önemli</strong>');
    expect(paragraphsOf('## Başlık\n\nBirinci\n\n\nİkinci')).toEqual([
      'Başlık',
      'Birinci',
      'İkinci',
    ]);
  });
});
