// @tk TK-28
// Karar numarasıyla doğrudan erişim (UYAP emsal karar kaynağı): daire + esas + karar alanlarıyla kesin
// eşleme (021 §5.7.1 tırnaklı zorunlu ifade + normalize alan eşitliği); madde odaklı mevzuat çıktısında
// değişiklik tarihi. Ağsız: kayıtlı resmî yanıt gövdesi sabit taşıyıcıyla verilir.
import { readFileSync } from 'node:fs';
import { McpSearchDecisionsSuccess } from '@eda/contracts/mcp';
import { describe, expect, it } from 'vitest';
import { latestAmendedAt, splitLawArticles } from '../../src/sources/mevzuat/articles.ts';
import {
  canonicalCaseNo,
  planBedestenSearch,
  searchDecisions,
} from '../../src/tools/search-decisions.ts';
import { CTX, FIXTURES, makeDeps, NULLS, scripted } from '../helpers.ts';

const base = {
  source: 'bedesten' as const,
  query: '',
  court_types: null,
  page: 1,
  page_size: 5,
  ...NULLS,
};

/** 3. HD 2023 kayıtlı arama yanıtı; her arama isteğine aynı gövde döner (eşleme sunucuda süzülür). */
function h3Transport() {
  const fx = JSON.parse(readFileSync(`${FIXTURES}bedesten/search-h3-2023.json`, 'utf8')) as {
    response: { status: number; headers: Record<string, string>; body: string };
  };
  return scripted(() => fx.response);
}

describe('search_decisions: esas/karar numarası ile kesin eşleme', () => {
  it('daire + esas + karar: tırnaklı zorunlu ifade, birimAdi ve yalnız Yargıtay türü', () => {
    const { body, warnings, courtTypes } = planBedestenSearch({
      ...base,
      chamber: 'H3',
      esas_no: '2022/8302',
      karar_no: '2023/167',
    });
    expect(body.phrase).toBe('+"2022 8302" +"2023 167"');
    expect(body.birimAdi).toBe('3. Hukuk Dairesi');
    expect(body.itemTypeList).toEqual(['YARGITAYKARARI']);
    expect(courtTypes).toEqual(['yargitay']);
    expect(warnings).toEqual(['esas_postfiltered']);
  });

  it('baştaki sıfırlı numara kanonikleşir ("2022/08302" → "2022/8302")', () => {
    expect(canonicalCaseNo('2022/08302')).toBe('2022/8302');
    expect(canonicalCaseNo('2020/3-0015')).toBe('2020/3-15');
    expect(canonicalCaseNo(null)).toBeNull();
    const { body } = planBedestenSearch({ ...base, esas_no: '2022/08302' });
    expect(body.phrase).toBe('+"2022 8302"');
  });

  it('esas + karar birlikte yalnız o kararı döndürür; alanlar normalize sonuçla eşleşir', async () => {
    const deps = makeDeps({ transport: h3Transport().transport });
    const out = await searchDecisions(
      deps,
      { ...base, chamber: 'H3', esas_no: '2022/08302', karar_no: '2023/167' },
      CTX,
    );
    expect(McpSearchDecisionsSuccess.parse(out)).toBeTruthy();
    expect(out.results.map((r) => r.document_id)).toEqual(['979779300']);
    expect(out.results[0]).toMatchObject({
      court_type: 'yargitay',
      chamber_code: 'H3',
      esas_no: '2022/8302',
      karar_no: '2023/167',
      decision_date: '2023-02-21',
    });
    expect(out.warnings).toContain('esas_postfiltered');
  });

  it('karar numarası uyuşmazsa sonuç boş (yakın numara kabul edilmez)', async () => {
    const deps = makeDeps({ transport: h3Transport().transport });
    const out = await searchDecisions(
      deps,
      { ...base, chamber: 'H3', esas_no: '2022/8302', karar_no: '2023/999' },
      CTX,
    );
    expect(out.results).toEqual([]);
  });

  it('yalnız karar numarasıyla da erişilir', async () => {
    const deps = makeDeps({ transport: h3Transport().transport });
    const out = await searchDecisions(deps, { ...base, karar_no: '2023/168' }, CTX);
    expect(out.results.map((r) => r.document_id)).toEqual(['979779900']);
  });
});

describe('get_legislation_live: madde odaklı çıktıda değişiklik tarihi', () => {
  // Sentetik konsolide metin (turndown çıktısı biçiminde); kanun ve tarihler uydurmadır.
  const md = [
    'Tanımlar',
    '**Madde 1 –** (Değişik: 11/1/2011-6098/1 md.) Bu Kanunda geçen terimler şunlardır.',
    'Kapsam',
    '**Madde 2 –** Bu Kanun bütün sözleşmelere uygulanır.',
    'Yürürlük',
    '**Madde 3 –** (Ek: 5/6/2019-7176/3 md.) Bu Kanun yayımı tarihinde yürürlüğe girer.',
  ].join('\n\n');

  it('madde notundaki tarih amendedAt olur; notu olmayan madde null', () => {
    const arts = splitLawArticles(md);
    expect(arts.map((a) => [a.articleNo, a.heading, a.amendedAt])).toEqual([
      ['1', 'Tanımlar', '2011-01-11'],
      ['2', 'Kapsam', null],
      ['3', 'Yürürlük', '2019-06-05'],
    ]);
  });

  it('getirilen maddelerin en geç değişiklik tarihi last_amended_at için seçilir', () => {
    const arts = splitLawArticles(md);
    expect(latestAmendedAt(arts)).toBe('2019-06-05');
    expect(latestAmendedAt(arts.slice(0, 1))).toBe('2011-01-11');
    expect(latestAmendedAt(arts.slice(1, 2))).toBeNull();
    expect(latestAmendedAt([])).toBeNull();
  });
});
