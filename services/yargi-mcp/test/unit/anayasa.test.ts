// @tk TK-28
// KK-P11-15 / KK-021-12: AYM (norm denetimi + bireysel başvuru) arama gövdesi ve normalize sonuçlar;
// KK-P11-3 / KK-021-11: belge kimliği SSRF listesi; KK-P11-9 / KK-021-17: belge tamponu; KK-P11-16:
// "İtirazın Gerekçesi" gerekçe sayılmaz. Kayıtlı resmî yanıtlarla (2026-10-10), ağsız. Bireysel başvuru
// kayıtlarında başvurucu/vekil adları fixture içinde baş harflere indirilmiştir.
import { McpGetDecisionSuccess, McpSearchDecisionsSuccess } from '@eda/contracts/mcp';
import { describe, expect, it } from 'vitest';
import { defaultSourcesConfig } from '../../src/config/sources.ts';
import { buildAymPayload } from '../../src/sources/anayasa/client.ts';
import { parseAnayasaId } from '../../src/sources/anayasa/document-id.ts';
import { SourceError } from '../../src/sources/errors.ts';
import { getDecision } from '../../src/tools/get-decision.ts';
import { planAnayasaSearch } from '../../src/tools/search-anayasa.ts';
import { searchDecisions } from '../../src/tools/search-decisions.ts';
import { sourceStatus } from '../../src/tools/source-status.ts';
import { CTX, FakeClock, json, makeDeps, NULLS, replay, scripted } from '../helpers.ts';

const ENABLED = ['bedesten', 'anayasa', 'uyusmazlik', 'mevzuat'] as const;
const base = { source: 'anayasa' as const, page: 1, page_size: 3, ...NULLS };
const deps = (transport: Parameters<typeof makeDeps>[0]['transport']) =>
  makeDeps({ transport, enabled: [...ENABLED] });

describe('KK-P11-15: AYM arama gövdesi (canlı biçim, AS-0062)', () => {
  it('yalnız norm: kararTipi NormDenetimi, 0 tabanlı sayfa, dize alanlar, norm alan adı', () => {
    const plan = planAnayasaSearch({
      ...base,
      query: ' mülkiyet hakkı ',
      court_types: ['aym_norm'],
      date_from: '2024-01-01',
      date_to: '2024-12-31',
      page: 2,
    });
    expect(plan.host).toBe('normkararlarbilgibankasi.anayasa.gov.tr');
    expect(JSON.parse(buildAymPayload(plan.body))).toEqual({
      kararTipi: 'NormDenetimi',
      query: 'mülkiyet hakkı',
      kararTarihiStart: '2024-01-01',
      kararTarihiEnd: '2024-12-31',
      page: '1',
      size: '3',
    });
  });

  it('yalnız bireysel: esas_no başvuru numarasıdır, serbest metin gönderilmez, bireysel alan adı', () => {
    const plan = planAnayasaSearch({
      ...base,
      query: 'mülkiyet',
      court_types: ['aym_bireysel'],
      esas_no: '2019/27727',
    });
    expect(plan.host).toBe('kararlarbilgibankasi.anayasa.gov.tr');
    expect(plan.body).toEqual({
      kararTipi: 'BireyselBasvuru',
      basvuruNo: '2019/27727',
      page: '0',
      size: '3',
    });
  });

  it('iki tür (veya null): kararTipi süzgeci yok; daire kodu yok sayılır', () => {
    for (const court_types of [null, ['aym_bireysel', 'aym_norm'] as const]) {
      const plan = planAnayasaSearch({
        ...base,
        query: 'ifade özgürlüğü',
        court_types: court_types ? [...court_types] : null,
        chamber: 'H9',
      });
      expect('kararTipi' in plan.body).toBe(false);
      expect(plan.courtTypes).toEqual(['aym_norm', 'aym_bireysel']);
      expect(plan.warnings).toEqual(['chamber_ignored']);
    }
  });

  it('uyumsuz mahkeme türü ve bireysel kararda karar no VALIDATION_FAILED', () => {
    expect(() =>
      planAnayasaSearch({ ...base, query: 'mülkiyet', court_types: ['yargitay'] }),
    ).toThrow(SourceError);
    expect(() =>
      planAnayasaSearch({
        ...base,
        query: 'mülkiyet',
        court_types: ['aym_bireysel'],
        karar_no: '2025/42',
      }),
    ).toThrow(SourceError);
  });
});

describe('KK-P11-15: AYM kayıtlı yanıtların normalizasyonu', () => {
  it('norm araması: künye, ND kimliği, resmî bağlantı, özet ≤ 300, facet; şemaya uyar', async () => {
    const t = replay();
    const out = await searchDecisions(
      deps(t.transport),
      { ...base, query: 'mülkiyet hakkı', court_types: ['aym_norm'] },
      CTX,
    );
    expect(McpSearchDecisionsSuccess.parse(out)).toBeTruthy();
    expect([out.total, out.has_more, out.results.length]).toEqual([3046, true, 3]);
    const first = out.results[0];
    expect(first).toMatchObject({
      document_id: 'ND/2025/42',
      court_type: 'aym_norm',
      court: 'Anayasa Mahkemesi',
      chamber: null,
      chamber_code: null,
      esas_no: '2024/176',
      karar_no: '2025/42',
      decision_date: '2025-02-11',
      title: 'Anayasa Mahkemesi E. 2024/176 K. 2025/42',
      url: 'https://normkararlarbilgibankasi.anayasa.gov.tr/ND/2025/42',
    });
    expect(first?.snippet?.startsWith('İTİRAZIN KONUSU:')).toBe(true);
    expect(out.results.every((r) => (r.snippet?.length ?? 0) <= 300)).toBe(true);
    expect(first?.facets).toEqual(
      expect.arrayContaining([
        { key: 'inceleme_sonuc', value: 'Esas - Ret' },
        { key: 'madde', value: '151/2-b' },
        { key: 'resmi_gazete', value: '06.05.2025 - 32892' },
      ]),
    );
    expect(new URL(t.calls[0]?.url ?? '').host).toBe('normkararlarbilgibankasi.anayasa.gov.tr');
    expect(t.calls[0]?.headers['User-Agent']).toMatch(/^EDA-Hukuk-Kaynak-Istemcisi/);
  });

  it('bireysel araması: tarih süzgeci portalda, B. No esas_no, bölüm adı; başvurucu adı sonuçta yok', async () => {
    const out = await searchDecisions(
      deps(replay().transport),
      {
        ...base,
        query: 'mülkiyet hakkı',
        court_types: ['aym_bireysel'],
        date_from: '2024-01-01',
        date_to: '2024-12-31',
      },
      CTX,
    );
    expect(McpSearchDecisionsSuccess.parse(out)).toBeTruthy();
    expect(out.warnings).toEqual([]);
    expect(out.results).toHaveLength(3);
    for (const r of out.results) {
      expect(r.court_type).toBe('aym_bireysel');
      expect(r.decision_date?.startsWith('2024-')).toBe(true);
      expect(r.document_id).toBe(`BB/${r.esas_no}`);
      expect(r.karar_no).toBeNull();
      expect(r.chamber).toMatch(/Bölüm|Genel Kurul/);
      expect(r.title).toBe(`Anayasa Mahkemesi ${r.chamber} B. No: ${r.esas_no}`);
      expect(r.url).toBe(`https://kararlarbilgibankasi.anayasa.gov.tr/${r.document_id}`);
    }
    // Fixture'daki `basvuruAdi` (başvurucu unvanı) normalize sonuca taşınmaz.
    expect(JSON.stringify(out)).not.toMatch(/basvuruAdi|YALNIZLAR|MENDERES PAMUK/);
  });

  it('sonuçsuz arama: boş liste, total 0, has_more false', async () => {
    const out = await searchDecisions(
      deps(replay().transport),
      { ...base, query: 'qxzvbnwmrtpl', court_types: null },
      CTX,
    );
    expect([out.results.length, out.total, out.has_more]).toEqual([0, 0, false]);
  });

  it('norm/bireysel dışı türler (siyasi parti vb.) sonuçtan düşer', async () => {
    const t = scripted(() =>
      json({
        total: 2,
        page: 1,
        data: [
          { kararTipi: 'SiyasiParti', id: 'a', esasNo: '2023/1', kararNo: '2024/1' },
          { kararTipi: 'NormDenetimi', id: 'b', esasNo: '2023/2', kararNo: '2024/2' },
        ],
      }),
    );
    const out = await searchDecisions(
      deps(t.transport),
      { ...base, query: 'parti', court_types: null },
      CTX,
    );
    expect(out.results.map((r) => r.document_id)).toEqual(['ND/2024/2']);
  });

  it('beklenmeyen yanıt biçimi SOURCE_UNAVAILABLE / parse_error', async () => {
    const t = scripted(() => ({ status: 200, headers: {}, body: '<html>bakım</html>' }));
    await expect(
      searchDecisions(deps(t.transport), { ...base, query: 'mülkiyet', court_types: null }, CTX),
    ).rejects.toMatchObject({ code: 'SOURCE_UNAVAILABLE', reason: 'parse_error' });
  });
});

describe('get_decision / anayasa (kayıtlı tam metin, icerik HTML)', () => {
  const ND = { source: 'anayasa' as const, document_id: 'ND/2025/42', section: null };

  it('soğuk yol: kalıcı numara çözülür + tekil kayıt; rol etiketli bölümler; şemaya uyar', async () => {
    const t = replay();
    const out = await getDecision(deps(t.transport), ND, CTX);
    expect(McpGetDecisionSuccess.parse(out)).toBeTruthy();
    expect(t.calls.map((c) => JSON.parse(c.body ?? '{}'))).toEqual([
      { kararTipi: 'NormDenetimi', kararNo: '2025/42', page: '0', size: '5' },
      { kararTipi: 'NormDenetimi', id: '7c31037d-be2a-4a4b-087f-ab5ff35e0a2e', size: '1' },
    ]);
    expect(out).toMatchObject({
      court_type: 'aym_norm',
      court: 'Anayasa Mahkemesi',
      esas_no: '2024/176',
      karar_no: '2025/42',
      decision_date: '2025-02-11',
      url: 'https://normkararlarbilgibankasi.anayasa.gov.tr/ND/2025/42',
      mime_type: 'text/html',
      text_status: 'ok',
      warnings: [],
    });
    const roles = out.sections.map((s) => s.role);
    expect(roles[0]).toBe('kunye');
    for (const r of ['istem', 'taraf_iddiasi', 'gerekce', 'hukum'] as const)
      expect(roles).toContain(r);
    expect(roles.at(-1)).toBe('hukum');
    const all = out.sections.map((s) => s.markdown).join('\n');
    expect(all).not.toMatch(/<\/?(p|span|div|table|style)\b|mso-|font-family/i);
    expect(out.content_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('KK-P11-16: "İtirazın Gerekçesi" (başvuran mahkemenin gerekçesi) taraf iddiasıdır', async () => {
    const out = await getDecision(deps(replay().transport), ND, CTX);
    const itiraz = out.sections.find((s) => s.markdown?.includes('B. İtirazın Gerekçesi'));
    expect(itiraz?.role).toBe('taraf_iddiasi');
    const ilk = out.sections.find((s) => s.markdown?.includes('II. İLK İNCELEME'));
    expect(ilk?.role).toBe('diger');
  });

  it('KK-021-17: aramada görülen kayıt çözümleme isteği atlanır; ikinci istek tampondan', async () => {
    const t = replay();
    const d = deps(t.transport);
    await searchDecisions(d, { ...base, query: 'mülkiyet hakkı', court_types: ['aym_norm'] }, CTX);
    await getDecision(d, ND, CTX);
    const again = await getDecision(d, { ...ND, section: 2 }, CTX);
    expect(again.cached).toBe(true);
    expect(t.calls).toHaveLength(2);
    expect(JSON.parse(t.calls[1]?.body ?? '{}')).toHaveProperty('id');
  });

  it('bireysel karar: bölüm, B. No, karşı oy bölümü; başvurucu adı yalnız baş harf', async () => {
    const out = await getDecision(
      deps(replay().transport),
      { source: 'anayasa', document_id: 'BB/2019/27727', section: null },
      CTX,
    );
    expect(McpGetDecisionSuccess.parse(out)).toBeTruthy();
    expect(out).toMatchObject({
      court_type: 'aym_bireysel',
      chamber: 'İkinci Bölüm',
      esas_no: '2019/27727',
      karar_no: null,
      decision_date: '2025-01-08',
      title: 'Anayasa Mahkemesi İkinci Bölüm B. No: 2019/27727',
    });
    const roles = out.sections.map((s) => s.role);
    expect(roles.slice(0, 2)).toEqual(['kunye', 'istem']);
    expect(roles).toContain('gerekce');
    expect(roles).toContain('hukum');
    expect(roles.at(-1)).toBe('karsi_oy');
  });

  it('bulunamayan karar numarası SOURCE_DOCUMENT_NOT_FOUND (tekil kayıt isteği atılmaz)', async () => {
    const t = replay();
    await expect(
      getDecision(deps(t.transport), { ...ND, document_id: 'ND/1960/9999' }, CTX),
    ).rejects.toMatchObject({ code: 'SOURCE_DOCUMENT_NOT_FOUND', source: 'anayasa' });
    expect(t.calls).toHaveLength(1);
  });

  it('KK-P11-8: boş icerik → text_unavailable, bölüm yok', async () => {
    const t = scripted((req) => {
      const body = JSON.parse(req.body ?? '{}') as Record<string, string>;
      const item = { kararTipi: 'NormDenetimi', id: 'u1', esasNo: '2024/1', kararNo: '2025/7' };
      return json({ total: 1, data: [body.id ? { ...item, icerik: '' } : item] });
    });
    const out = await getDecision(deps(t.transport), { ...ND, document_id: 'ND/2025/7' }, CTX);
    expect([out.text_status, out.total_sections, out.content_sha256]).toEqual([
      'text_unavailable',
      0,
      null,
    ]);
  });
});

describe('KK-P11-3 / KK-021-11: AYM belge kimliği istek atılmadan reddedilir', () => {
  const payloads = [
    'https://normkararlarbilgibankasi.anayasa.gov.tr/ND/2025/42',
    'ND/2025/42/../1',
    'ND/2025/042',
    'nd/2025/42',
    'ND/25/42',
    'BB/2019/27727?x=1',
    'BB/2019/1234567',
    'ND/2025/42 ',
    'ND%2F2025%2F42',
    'ND/２０２５/42',
    'BB\\2019\\1',
    'SP/2024/1',
  ];
  for (const id of payloads) {
    it(`${JSON.stringify(id)} → VALIDATION_FAILED / invalid_document_id`, async () => {
      const t = replay();
      await expect(
        getDecision(deps(t.transport), { source: 'anayasa', document_id: id, section: null }, CTX),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED', reason: 'invalid_document_id' });
      expect(t.calls).toHaveLength(0);
    });
  }

  it('geçerli kimlikler ayrıştırılır', () => {
    expect(parseAnayasaId('ND/2025/42')).toEqual({ courtType: 'aym_norm', number: '2025/42' });
    expect(parseAnayasaId('BB/2019/27727')).toEqual({
      courtType: 'aym_bireysel',
      number: '2019/27727',
    });
  });
});

describe('KK-P11-5: anayasa kovası kendi aralığını kullanır (sources.anayasa.tokenIntervalMs)', () => {
  it('ardışık iki interactive arama arasında 2000 ms; Bedesten kovası etkilenmez', async () => {
    const clock = new FakeClock();
    const sentAt: number[] = [];
    const t = scripted(() => {
      sentAt.push(clock.now());
      return json({ total: 0, data: [] });
    });
    const cfg = defaultSourcesConfig();
    const d = makeDeps({ transport: t.transport, clock, cfg, enabled: [...ENABLED] });
    await searchDecisions(d, { ...base, query: 'mülkiyet', court_types: null }, CTX);
    await searchDecisions(d, { ...base, query: 'mülkiyet', court_types: null, page: 2 }, CTX);
    expect((sentAt[1] ?? 0) - (sentAt[0] ?? 0)).toBe(cfg.anayasaTokenIntervalMs);
    expect((await d.gateway.bucketSnapshot('bedesten')).fillPct).toBe(100);
  });
});

describe('source_status: dört MVP canlı kaynak bağdaştırıcısı etkin (AS-P11-12 kapandı)', () => {
  it('anayasa ve uyusmazlik etkin; kendi kovaları; kapsam dışı olan disabled', async () => {
    const d = makeDeps({ transport: replay().transport, enabled: ['bedesten', 'anayasa'] });
    await searchDecisions(d, { ...base, query: 'mülkiyet hakkı', court_types: ['aym_norm'] }, CTX);
    const bySource = new Map((await sourceStatus(d)).sources.map((s) => [s.source, s]));
    expect(bySource.get('anayasa')).toMatchObject({ enabled: true, state: 'up' });
    expect(bySource.get('anayasa')?.counters_1h.requests).toBe(1);
    expect(bySource.get('bedesten')?.counters_1h.requests).toBe(0);
    expect(bySource.get('uyusmazlik')).toMatchObject({ enabled: false, state: 'disabled' });
  });
});
