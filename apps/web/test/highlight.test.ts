import { describe, expect, it } from 'vitest';
import { claimFor, findPassage, splitByRanges } from '../src/features/chat/highlight.ts';

const EXCERPT =
  'Gerekçe (başı): Davacı, işverenin haklı neden olmaksızın iş sözleşmesini feshettiğini ileri sürmüştür. ' +
  'Dosya kapsamına göre fesih geçerli bir nedene dayanmamaktadır ve kıdem tazminatı koşulları oluşmuştur.\n' +
  'Hüküm: Davanın kabulüne karar verilmiştir.';

describe('claimFor', () => {
  it('etiketli cümleyi etiketsiz döndürür', () => {
    const a =
      'Giriş cümlesi. Fesih geçerli nedene dayanmadığı için tazminat doğar [K2]. Başka cümle [K3].';
    expect(claimFor(a, 'K2')).toBe('Fesih geçerli nedene dayanmadığı için tazminat doğar .');
  });
  it('etiket tek başına kalırsa önceki cümleyi alır', () => {
    expect(claimFor('Mahkeme davayı kabul etti. [K1]', 'K1')).toBe('Mahkeme davayı kabul etti.');
  });
});

describe('findPassage', () => {
  it('tırnak içi alıntıyı birebir bulur', () => {
    const p = findPassage('Mahkeme "fesih geçerli bir nedene dayanmamaktadır" demiştir', EXCERPT);
    expect(p?.kind).toBe('quote');
    const r = p?.ranges[0];
    expect(EXCERPT.slice(r?.start, r?.end)).toBe('fesih geçerli bir nedene dayanmamaktadır');
  });
  it('birebir olmayan alıntıyı işaretler', () => {
    const p = findPassage(
      'Mahkeme "fesih tamamen haksızdır ve tazminat ödenmelidir" demiştir',
      EXCERPT,
    );
    expect(p?.unmatchedQuotes).toHaveLength(1);
  });
  it('ortak köklere göre en yakın cümleyi seçer', () => {
    const p = findPassage(
      'Fesih geçerli nedene dayanmadığı için kıdem tazminatı koşulları oluşur',
      EXCERPT,
    );
    expect(p?.kind).toBe('overlap');
    const text = p?.ranges.map((r) => EXCERPT.slice(r.start, r.end)).join(' ');
    expect(text).toContain('kıdem tazminatı koşulları oluşmuştur');
  });
  it('alakasız yanıtta vurgu uydurmaz', () => {
    expect(findPassage('Kira bedelinin artırımı yasal sınırlara tabidir', EXCERPT)).toBeNull();
  });
});

describe('splitByRanges', () => {
  it('vurgulu ve vurgusuz parçaları sırayla verir', () => {
    expect(splitByRanges('abcdef', [{ start: 2, end: 4 }])).toEqual([
      { text: 'ab', mark: false },
      { text: 'cd', mark: true },
      { text: 'ef', mark: false },
    ]);
  });
});
