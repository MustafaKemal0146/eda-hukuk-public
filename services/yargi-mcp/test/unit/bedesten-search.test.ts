// @tk TK-28
// KK-021-12: Bedesten arama gövdesi, daire kodu ↔ birimAdi, normalize sonuç (kayıtlı resmî yanıtlarla, ağsız).
import { ChamberCode, McpSearchDecisionsSuccess } from '@eda/contracts/mcp';
import { describe, expect, it } from 'vitest';
import { CHAMBER_TO_BIRIM, chamberCodeOf } from '../../src/sources/bedesten/chambers.ts';
import { buildSearchPayload } from '../../src/sources/bedesten/client.ts';
import { SourceError } from '../../src/sources/errors.ts';
import { planBedestenSearch, searchDecisions } from '../../src/tools/search-decisions.ts';
import { CTX, makeDeps, NULLS, replay } from '../helpers.ts';

const base = { source: 'bedesten' as const, page: 1, page_size: 10, ...NULLS };

describe('KK-P11-4 / KK-021-12: Bedesten arama gövdesi', () => {
  it('021 §5.7.1 örneğiyle alan alan eşleşir; sortFields yok (alaka sırası)', () => {
    const { body } = planBedestenSearch({
      ...base,
      query: '"fazla mesai" +tanık',
      court_types: ['yargitay'],
      chamber: 'H9',
      date_from: '2023-01-01',
      date_to: '2024-12-31',
    });
    expect(JSON.parse(buildSearchPayload(body))).toEqual({
      data: {
        pageSize: 10,
        pageNumber: 1,
        itemTypeList: ['YARGITAYKARARI'],
        phrase: '"fazla mesai" +tanık',
        birimAdi: '9. Hukuk Dairesi',
        kararTarihiStart: '2023-01-01T00:00:00.000Z',
        kararTarihiEnd: '2024-12-31T23:59:59.999Z',
      },
      applicationName: 'UyapMevzuat',
      paging: true,
    });
  });

  it('daire filtresi yokken gövdede birimAdi anahtarı bulunmaz', () => {
    const { body } = planBedestenSearch({ ...base, query: 'kira', court_types: null });
    expect('birimAdi' in body).toBe(false);
    expect(body.itemTypeList).toEqual([
      'YARGITAYKARARI',
      'DANISTAYKARAR',
      'ISTINAFHUKUK',
      'YERELHUKUK',
      'KYB',
    ]);
  });

  it('23 + 23 + 17 daire kodu ve kurullar ters eşlenebilir', () => {
    const codes = [...CHAMBER_TO_BIRIM.keys()];
    expect(codes.filter((c) => /^H\d+$/.test(c))).toHaveLength(23);
    expect(codes.filter((c) => /^C\d+$/.test(c))).toHaveLength(23);
    expect(codes.filter((c) => /^D\d+$/.test(c))).toHaveLength(17);
    for (const [code, name] of CHAMBER_TO_BIRIM) {
      const court = /^(D\d+|DBGK|IDDK|VDDK|IBK|IIK|DBK)$/.test(code) ? 'danistay' : 'yargitay';
      expect(chamberCodeOf(court, name)).toBe(code);
    }
  });

  it('daire ile uyumsuz mahkeme türü ve AYM türü VALIDATION_FAILED', () => {
    expect(() =>
      planBedestenSearch({ ...base, query: 'kira', court_types: ['danistay'], chamber: 'H3' }),
    ).toThrow(SourceError);
    expect(() => planBedestenSearch({ ...base, query: 'kira', court_types: ['aym_norm'] })).toThrow(
      SourceError,
    );
  });

  it('esas no verilirse zorunlu tırnaklı ifade + esas_postfiltered', () => {
    const { body, warnings } = planBedestenSearch({
      ...base,
      query: 'kira',
      court_types: null,
      esas_no: '2022/8302',
    });
    expect(body.phrase).toBe('+"2022 8302"');
    expect(warnings).toContain('esas_postfiltered');
  });
});

describe('KK-P11-4 / KK-082-5: ChamberCode kümesi = Bedesten daire kodu kümesi', () => {
  it('regex kabul kümesi tablo kodları + AYİM tarihsel kodlarıyla (082 §4) birebir aynı', () => {
    const numbered = ['H', 'C', 'D', 'AYIM'].flatMap((p) =>
      Array.from({ length: 100 }, (_, i) => `${p}${i}`),
    );
    const named = ['HGK', 'CGK', 'BGK', 'HBK', 'CBK', 'DBGK', 'IDDK', 'VDDK', 'IBK', 'IIK', 'DBK'];
    const extra = ['AYIM', 'AYIMDK', 'AYIMB', 'H01', 'D', 'HGKX', 'YHGK'];
    const accepted = [...numbered, ...named, ...extra].filter(
      (c) => ChamberCode.safeParse(c).success,
    );
    const historicalAyim = ['AYIM', 'AYIMDK', 'AYIMB', 'AYIM1', 'AYIM2', 'AYIM3'];
    const catalog = [...CHAMBER_TO_BIRIM.keys(), ...historicalAyim];
    expect(new Set(accepted)).toEqual(new Set(catalog));
    expect(accepted).toHaveLength(catalog.length);
  });
});

describe('KK-021-12: kayıtlı yanıtların normalizasyonu', () => {
  it('Yargıtay araması 10 sonuç, şemaya uygun, has_more ve künye alanları', async () => {
    const t = replay();
    const deps = makeDeps({ transport: t.transport });
    const out = await searchDecisions(
      deps,
      { ...base, query: 'tahliye taahhüdü', court_types: ['yargitay'] },
      CTX,
    );
    expect(McpSearchDecisionsSuccess.parse(out)).toBeTruthy();
    expect(out.results).toHaveLength(10);
    expect(out.has_more).toBe(true);
    const first = out.results[0];
    expect(first?.court).toBe('Yargıtay');
    expect(first?.chamber_code).toMatch(/^H\d+$/);
    expect(first?.title).toMatch(/^Yargıtay \d+\. Hukuk Dairesi E\. \d{4}\/\d+ K\. \d{4}\/\d+$/);
    expect(first?.url).toMatch(/^https:\/\/mevzuat\.adalet\.gov\.tr\/ictihat\/\d+$/);
    expect(first?.decision_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(t.calls[0]?.headers.AdaletApplicationName).toBe('UyapMevzuat');
    expect(t.calls[0]?.headers['User-Agent']).toMatch(/^EDA-Hukuk-Kaynak-Istemcisi/);
  });

  it('daire + tarih süzgeci (H3, 2023): 3. Hukuk Dairesi kararları', async () => {
    const deps = makeDeps({ transport: replay().transport });
    const out = await searchDecisions(
      deps,
      {
        ...base,
        page_size: 5,
        query: '"tahliye taahhüdü"',
        court_types: null,
        chamber: 'H3',
        date_from: '2023-01-01',
        date_to: '2023-12-31',
      },
      CTX,
    );
    expect(out.results.length).toBeGreaterThan(0);
    for (const r of out.results) {
      expect(r.chamber).toBe('3. Hukuk Dairesi');
      expect(r.decision_date?.startsWith('2023-')).toBe(true);
    }
  });

  it('Danıştay itemType DANISTAYKARAR → court_type danistay, "N. Daire" → D kodu', async () => {
    const deps = makeDeps({ transport: replay().transport });
    const out = await searchDecisions(
      deps,
      { ...base, page_size: 3, query: '"imar planı"', court_types: ['danistay'] },
      CTX,
    );
    expect(out.results.every((r) => r.court_type === 'danistay' && r.court === 'Danıştay')).toBe(
      true,
    );
    expect(out.results[0]?.chamber_code).toMatch(/^D\d+$/);
  });

  it('sonuçsuz arama: boş liste, total 0, has_more false', async () => {
    const deps = makeDeps({ transport: replay().transport });
    const out = await searchDecisions(
      deps,
      { ...base, query: 'qxzvbnwmrtpl', court_types: ['yargitay'] },
      CTX,
    );
    expect([out.results.length, out.total, out.has_more]).toEqual([0, 0, false]);
  });

  it('kapsam dışı kaynak (anayasa) portala gitmeden SOURCE_NOT_IN_COVERAGE', async () => {
    const t = replay();
    const deps = makeDeps({ transport: t.transport });
    await expect(
      searchDecisions(
        deps,
        { ...base, source: 'anayasa', query: 'mülkiyet', court_types: null },
        CTX,
      ),
    ).rejects.toMatchObject({ code: 'SOURCE_NOT_IN_COVERAGE', reason: 'source_disabled' });
    expect(t.calls).toHaveLength(0);
  });
});
