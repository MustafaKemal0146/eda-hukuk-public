// Karar Arşivi ve Mevzuat DTO'ları (P16.2, P15.9;): kimlik kodlama, madde biçimleri,
// süzgeç kuralları ve 003 §5 kısaltma tablosu.
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_CHAMBER_CODES,
  ARCHIVE_MAX_PAGES,
  ArticleNoParam,
  articleCitation,
  articleLabel,
  DecisionSearchRequest,
  decodeLiveDecisionId,
  encodeLiveDecisionId,
  LAW_TYPE_URL,
  LegislationSearchRequest,
  lawTypeFromUrl,
  SearchPageQuery,
  sourceToUrlArticleNo,
  urlToSourceArticleNo,
} from '../src/api/index.ts';
import { ChamberCode } from '../src/mcp/index.ts';

describe('KK-P16-25 canlı karar kimliği (053-04 §12)', () => {
  it('gidiş-dönüş; "/" içeren kimlik yol parçasında güvenli', () => {
    for (const doc of ['1000001', 'BB/2019/1234', 'Örnek/ç-ş']) {
      const id = encodeLiveDecisionId('anayasa', doc);
      expect(id).toMatch(/^live_anayasa_[A-Za-z0-9_-]+$/);
      expect(decodeLiveDecisionId(id)).toEqual({ source: 'anayasa', documentId: doc });
    }
  });

  it('geçersiz kimlikler reddedilir', () => {
    for (const bad of [
      'live_mevzuat_MTA',
      'live_bedesten_',
      'x_bedesten_MTA',
      'live_bedesten_!!',
    ]) {
      expect(decodeLiveDecisionId(bad)).toBeNull();
    }
  });
});

describe('KK-P16-3 arama isteği ve sayfa sorgusu', () => {
  const filters = { courtTypes: null, chamberCodes: null, dateFrom: null, dateTo: null };

  it('sorgu kırpılır; en az 2 karakter, en çok 20000', () => {
    expect(DecisionSearchRequest.parse({ query: '  kira  ', filters }).query).toBe('kira');
    expect(DecisionSearchRequest.safeParse({ query: ' a ', filters }).success).toBe(false);
    expect(DecisionSearchRequest.safeParse({ query: 'a'.repeat(20001), filters }).success).toBe(
      false,
    );
  });

  it('kanonik dışı mahkeme türü ve fazladan alan reddedilir', () => {
    const bad = { ...filters, courtTypes: ['bam'] };
    expect(DecisionSearchRequest.safeParse({ query: 'kira', filters: bad }).success).toBe(false);
    expect(
      DecisionSearchRequest.safeParse({ query: 'kira', filters: { ...filters, sources: [] } })
        .success,
    ).toBe(false);
  });

  it('sayfa sorgusu varsayılanları ve üst sınırı', () => {
    expect(SearchPageQuery.parse({})).toEqual({ page: 1, limit: 20, sort: 'relevance' });
    expect(SearchPageQuery.parse({ page: '2', sort: 'date_desc' }).page).toBe(2);
    expect(SearchPageQuery.safeParse({ page: String(ARCHIVE_MAX_PAGES + 1) }).success).toBe(false);
  });

  it('arşiv daire kodları MCP ChamberCode deseninin alt kümesidir', () => {
    for (const code of [...ARCHIVE_CHAMBER_CODES.yargitay, ...ARCHIVE_CHAMBER_CODES.danistay]) {
      expect(ChamberCode.safeParse(code).success, code).toBe(true);
    }
  });
});

describe('KK-P15-2 madde numarası biçimleri (053-05 §1.1)', () => {
  it('URL → kaynak anahtarı ve geri', () => {
    const cases: [string, string | null][] = [
      ['352', '352'],
      ['49-A', '49/A'],
      ['49-a', '49/A'],
      ['G5', 'G5'],
      ['G5-A', 'G5/A'],
      ['E3', 'E3'],
      ['M18', 'M18'],
      ['M18-A', null],
      ['007', '7'],
    ];
    for (const [url, key] of cases) expect(urlToSourceArticleNo(url), url).toBe(key);
    expect(sourceToUrlArticleNo('352/A')).toBe('352-A');
    expect(sourceToUrlArticleNo('12/Ç')).toBeNull();
  });

  it('AS-0349 regresyon: yargi-mcp 034 §9.3 anahtarı (G1, E3, M18) URL biçimine gidip döner', () => {
    const keys: [string, string][] = [
      ['352', '352'],
      ['352/A', '352-A'],
      ['G1', 'G1'],
      ['G2/B', 'G2-B'],
      ['E3', 'E3'],
      ['M18', 'M18'],
    ];
    for (const [key, url] of keys) {
      expect(sourceToUrlArticleNo(key), key).toBe(url);
      expect(urlToSourceArticleNo(url), url).toBe(key);
    }
    // P11 öncesi biçim hâlâ okunur.
    expect(sourceToUrlArticleNo('GEÇİCİ 1')).toBe('G1');
    expect(sourceToUrlArticleNo('EK 3')).toBe('E3');
  });

  it('etiket ve atıf biçimleri', () => {
    expect(articleLabel('352')).toBe('m. 352');
    expect(articleLabel('49-A')).toBe('m. 49/A');
    expect(articleLabel('G5')).toBe('geçici m. 5');
    expect(articleLabel('E3')).toBe('ek m. 3');
    expect(articleLabel('M18')).toBe('m. 18 (mükerrer)');
    expect(articleCitation('TBK', '6098', '352')).toBe('TBK m. 352');
    expect(articleCitation(null, '7777', '5')).toBe('7777 s. K. m. 5');
  });

  it('URL deseni', () => {
    for (const ok of ['1', '352', '49-A', 'G5', 'E3', 'M18']) {
      expect(ArticleNoParam.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ['49/A', 'g5', '12345', 'madde', '']) {
      expect(ArticleNoParam.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('KK-P15-9 mevzuat isteği ve tür eşlemesi', () => {
  it('arama isteği katı', () => {
    const base = { query: 'kira', lawNo: null, lawType: null, includeRepealed: false };
    expect(LegislationSearchRequest.safeParse(base).success).toBe(true);
    expect(LegislationSearchRequest.safeParse({ ...base, lawType: 'teblig' }).success).toBe(false);
    expect(LegislationSearchRequest.safeParse({ ...base, lawNo: '61a' }).success).toBe(false);
  });

  it('URL `tur` değerleri', () => {
    for (const [type, url] of Object.entries(LAW_TYPE_URL)) {
      expect(lawTypeFromUrl(url)).toBe(type);
    }
    expect(lawTypeFromUrl('teblig')).toBeNull();
  });
});
