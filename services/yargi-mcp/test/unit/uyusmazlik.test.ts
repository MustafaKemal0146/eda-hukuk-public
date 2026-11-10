// @tk TK-28
// KK-P11-15 / KK-021-12: Uyuşmazlık Mahkemesi arama formu, tablo ayrıştırma ve normalize sonuçlar;
// KK-P11-3 / KK-021-11: belge yolu SSRF listesi; KK-P11-9 / KK-021-17: belge tamponu; PDF → metin.
// Kayıtlı resmî yanıtlarla (2026-10-10), ağsız. Karar PDF'inde taraf adları portalda baş harflidir.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpGetDecisionSuccess, McpSearchDecisionsSuccess } from '@eda/contracts/mcp';
import { describe, expect, it } from 'vitest';
import { FixtureFile } from '../../src/http/fixtures.ts';
import { buildSearchForm } from '../../src/sources/uyusmazlik/client.ts';
import { esasFromDocId, isValidUyusmazlikId } from '../../src/sources/uyusmazlik/document-id.ts';
import { parseFormTokens, parseSearchPage } from '../../src/sources/uyusmazlik/parse.ts';
import { getDecision } from '../../src/tools/get-decision.ts';
import { searchDecisions } from '../../src/tools/search-decisions.ts';
import { planUyusmazlikSearch } from '../../src/tools/search-uyusmazlik.ts';
import { CTX, FIXTURES, makeDeps, NULLS, replay, scripted } from '../helpers.ts';

const ENABLED = ['bedesten', 'anayasa', 'uyusmazlik', 'mevzuat'] as const;
const base = { source: 'uyusmazlik' as const, page: 1, page_size: 5, ...NULLS };
const deps = (transport: Parameters<typeof makeDeps>[0]['transport']) =>
  makeDeps({ transport, enabled: [...ENABLED] });
const fixtureBody = (name: string): string =>
  FixtureFile.parse(JSON.parse(readFileSync(join(FIXTURES, 'uyusmazlik', name), 'utf8'))).response
    .body;

describe('KK-P11-15: Uyuşmazlık arama planı (canlı biçim, AS-0063)', () => {
  it('serbest metin → All; esas no → EsasNo; karar no → KararNo; uyarılar', () => {
    expect(planUyusmazlikSearch({ ...base, query: ' el atma ', court_types: null })).toEqual({
      text: 'el atma',
      scope: 'All',
      warnings: [],
    });
    expect(
      planUyusmazlikSearch({
        ...base,
        query: 'x',
        court_types: ['uyusmazlik'],
        esas_no: '2026/206',
        chamber: 'H1',
        date_from: '2026-01-01',
      }),
    ).toEqual({
      text: '2026/206',
      scope: 'EsasNo',
      warnings: ['chamber_ignored', 'date_filter_partial', 'esas_postfiltered'],
    });
    expect(
      planUyusmazlikSearch({ ...base, query: 'x', court_types: null, karar_no: '2026/331' }).scope,
    ).toBe('KararNo');
  });

  it('başka mahkeme türü VALIDATION_FAILED', () => {
    expect(() =>
      planUyusmazlikSearch({ ...base, query: 'görev', court_types: ['uyusmazlik', 'danistay'] }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED', reason: 'invalid_arguments' }));
  });

  it('form gövdesi: gizli alanlar + txtSearch + rblSearchScope + btnSearch (portal sırası)', () => {
    const tokens = parseFormTokens(fixtureBody('form.json'));
    expect(tokens).not.toBeNull();
    if (!tokens) return;
    const form = new URLSearchParams(buildSearchForm(tokens, 'el atma', 'All'));
    expect([...form.keys()]).toEqual([
      '__VIEWSTATE',
      '__VIEWSTATEGENERATOR',
      '__EVENTVALIDATION',
      'txtSearch',
      'rblSearchScope',
      'btnSearch',
    ]);
    expect([form.get('txtSearch'), form.get('rblSearchScope'), form.get('btnSearch')]).toEqual([
      'el atma',
      'All',
      'Ara',
    ]);
  });

  it('arama yapılmamış ilk sayfa (son kararlar listesi) sorgu sonucu sayılmaz', () => {
    expect(parseSearchPage(fixtureBody('form.json'))).toBeNull();
    expect(parseSearchPage(fixtureBody('search-empty.json'))).toEqual({ total: 0, rows: [] });
  });
});

describe('KK-P11-15: Uyuşmazlık kayıtlı yanıtların normalizasyonu', () => {
  it('tam metin araması: form sayfası + POST; künye, PDF kimliği, resmî bağlantı; şemaya uyar', async () => {
    const t = replay();
    const out = await searchDecisions(
      deps(t.transport),
      { ...base, query: 'kamulaştırmasız el atma', court_types: null },
      CTX,
    );
    expect(McpSearchDecisionsSuccess.parse(out)).toBeTruthy();
    expect(t.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', 'https://kararlar.uyusmazlik.gov.tr/'],
      ['POST', 'https://kararlar.uyusmazlik.gov.tr/'],
    ]);
    expect(t.calls[1]?.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect([out.total, out.has_more, out.results.length]).toEqual([1698, true, 5]);
    expect(out.results[0]).toEqual({
      source: 'uyusmazlik',
      document_id: 'Uploads/2026-206.pdf',
      court_type: 'uyusmazlik',
      court: 'Uyuşmazlık Mahkemesi',
      chamber: null,
      chamber_code: null,
      esas_no: '2026/206',
      karar_no: '2026/331',
      decision_date: '2026-06-15',
      title: 'Uyuşmazlık Mahkemesi E. 2026/206 K. 2026/331',
      snippet: null,
      url: 'https://kararlar.uyusmazlik.gov.tr/Uploads/2026-206.pdf',
      retrieved_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      origin: 'live',
      facets: null,
    });
  });

  it('form gizli alanları süreç içinde yeniden kullanılır; esas no araması tam eşitlikle süzülür', async () => {
    const t = replay();
    const d = deps(t.transport);
    await searchDecisions(d, { ...base, query: 'kamulaştırmasız el atma', court_types: null }, CTX);
    const out = await searchDecisions(
      d,
      { ...base, query: 'esas', court_types: ['uyusmazlik'], esas_no: '2026/206' },
      CTX,
    );
    expect(t.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'POST']);
    expect(out.results.map((r) => [r.esas_no, r.karar_no])).toEqual([['2026/206', '2026/331']]);
    expect(out.warnings).toEqual(['esas_postfiltered']);
  });

  it('tarih süzgeci dönen sayfada uygulanır (date_filter_partial)', async () => {
    const out = await searchDecisions(
      deps(replay().transport),
      { ...base, query: 'kamulaştırmasız el atma', court_types: null, date_from: '2026-05-01' },
      CTX,
    );
    expect(out.warnings).toEqual(['date_filter_partial']);
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results.every((r) => (r.decision_date ?? '') >= '2026-05-01')).toBe(true);
  });

  it('sonuçsuz arama: boş liste, total 0, has_more false', async () => {
    const out = await searchDecisions(
      deps(replay().transport),
      { ...base, query: 'qxzvbnwmrtpl', court_types: null },
      CTX,
    );
    expect([out.results.length, out.total, out.has_more]).toEqual([0, 0, false]);
  });

  it('page > 1 portala gitmeden boş sonuç + pagination_unsupported', async () => {
    const t = replay();
    const out = await searchDecisions(
      deps(t.transport),
      { ...base, query: 'el atma', court_types: null, page: 2 },
      CTX,
    );
    expect([out.results, out.total, out.has_more, out.warnings]).toEqual([
      [],
      null,
      null,
      ['pagination_unsupported'],
    ]);
    expect(t.calls).toHaveLength(0);
  });

  it('POST ilk sayfayı döndürürse parse_error; bayat gizli alanlar düşer, sonraki çağrı yeniden alır', async () => {
    const form = fixtureBody('form.json');
    const t = scripted(() => ({ status: 200, headers: {}, body: form }));
    const d = deps(t.transport);
    const args = { ...base, query: 'görev uyuşmazlığı', court_types: null };
    await expect(searchDecisions(d, args, CTX)).rejects.toMatchObject({
      code: 'SOURCE_UNAVAILABLE',
      reason: 'parse_error',
    });
    await expect(searchDecisions(d, args, CTX)).rejects.toMatchObject({ reason: 'parse_error' });
    expect(t.calls.map((c) => c.method)).toEqual(['GET', 'POST', 'GET', 'POST']);
  });
});

describe('get_decision / uyusmazlik (kayıtlı PDF)', () => {
  const ARGS = {
    source: 'uyusmazlik' as const,
    document_id: 'Uploads/2026-206.pdf',
    section: null,
  };

  it('PDF → metin; künye belge başlığından; rol etiketli bölümler; UYAP doğrulama satırı yok', async () => {
    const t = replay();
    const out = await getDecision(deps(t.transport), ARGS, CTX);
    expect(McpGetDecisionSuccess.parse(out)).toBeTruthy();
    expect(t.calls.map((c) => [c.method, c.url])).toEqual([
      ['GET', 'https://kararlar.uyusmazlik.gov.tr/Uploads/2026-206.pdf'],
    ]);
    expect(out).toMatchObject({
      court_type: 'uyusmazlik',
      court: 'Uyuşmazlık Mahkemesi',
      esas_no: '2026/206',
      karar_no: '2026/331',
      decision_date: '2026-06-15',
      title: 'Uyuşmazlık Mahkemesi E. 2026/206 K. 2026/331',
      mime_type: 'application/pdf',
      text_status: 'ok',
      warnings: [],
    });
    const roles = out.sections.map((s) => s.role);
    expect(roles.slice(0, 2)).toEqual(['kunye', 'istem']);
    expect(roles).toContain('diger');
    expect(roles).toContain('gerekce');
    expect(roles.at(-1)).toBe('hukum');
    // Yerel yargı yerlerinin kararları ("Başvuru süreci") mahkemenin gerekçesi değildir.
    const surec = out.sections.find((s) => s.markdown?.includes('UYUŞMAZLIĞA İLİŞKİN BAŞVURU'));
    expect(surec?.role).toBe('diger');
    const all = out.sections.map((s) => s.markdown).join('\n');
    expect(all).not.toContain('UYAP Bilişim Sistemindeki');
    expect(all).toContain('İDARİ YARGININ GÖREVLİ OLDUĞUNA');
  });

  it('KK-021-17: aynı belgenin bölüm isteği portala gitmez (tampon isabeti)', async () => {
    const t = replay();
    const d = deps(t.transport);
    await getDecision(d, ARGS, CTX);
    const again = await getDecision(d, { ...ARGS, section: 1 }, CTX);
    expect(again.cached).toBe(true);
    expect(again.sections.filter((s) => s.markdown !== null).map((s) => s.no)).toEqual([1]);
    expect(t.calls).toHaveLength(1);
  });

  it('portal 404 → SOURCE_DOCUMENT_NOT_FOUND', async () => {
    const t = scripted(() => ({ status: 404, headers: {}, body: '' }));
    await expect(
      getDecision(deps(t.transport), { ...ARGS, document_id: 'Uploads/1999-1.pdf' }, CTX),
    ).rejects.toMatchObject({ code: 'SOURCE_DOCUMENT_NOT_FOUND', source: 'uyusmazlik' });
  });

  it('dosya adından esas no yedeği', () => {
    expect(esasFromDocId('Uploads/2026-206.pdf')).toBe('2026/206');
    expect(esasFromDocId('Uploads/ek-karar.pdf')).toBeNull();
  });
});

describe('KK-P11-3 / KK-021-11: Uyuşmazlık belge yolu istek atılmadan reddedilir', () => {
  const payloads = [
    'https://kararlar.uyusmazlik.gov.tr/Uploads/2026-206.pdf',
    '//evil.example/Uploads/2026-206.pdf',
    '/Uploads/2026-206.pdf',
    '../Uploads/2026-206.pdf',
    'Uploads/../web.config',
    'Uploads/%2e%2e/x.pdf',
    'Uploads//2026-206.pdf',
    'Uploads/2026-206.pdf?x=1',
    'Uploads/2026-206.pdf#a',
    'Uploads/2026-206.exe',
    'Uploads\\2026-206.pdf',
    'uploads/2026-206.pdf',
    'Uploads/2026 206.pdf',
    'Uploads/2026-206．pdf',
  ];
  for (const id of payloads) {
    it(`${JSON.stringify(id)} → VALIDATION_FAILED / invalid_document_id`, async () => {
      const t = replay();
      await expect(
        getDecision(
          deps(t.transport),
          { source: 'uyusmazlik', document_id: id, section: null },
          CTX,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', reason: 'invalid_document_id' });
      expect(t.calls).toHaveLength(0);
      expect(isValidUyusmazlikId(id)).toBe(false);
    });
  }
});
