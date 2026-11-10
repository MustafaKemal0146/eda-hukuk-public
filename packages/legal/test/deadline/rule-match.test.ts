// @tk TK-14
// Kural eşleme (083 §7.1, §7.2; P22 K13, K10). Kural kodu model argümanı değildir; eşleme takma
// adlarla ve `tr_fold` iledir.
import { describe, expect, it } from 'vitest';
import {
  aliasScore,
  candidatesForDocType,
  resolveRuleByAlias,
} from '../../src/deadline-engine/index.ts';
import { allCatalogRules } from './helpers.ts';

const RULES = allCatalogRules({ verified: true });

describe('KK-P22-17 (KK-083-18) calculate_deadline takma ad eşlemesi', () => {
  it('1: tam eşitlik tekil en yüksek skor (Türkçe büyük harf ve şapka katlanır)', () => {
    const m = resolveRuleByAlias('İSTİNAF', 'hmk', RULES);
    expect(m.status).toBe('matched');
    if (m.status === 'matched') {
      expect(m.rule.code).toBe('hmk_istinaf_basvuru');
      expect(m.score).toBe(100);
    }
  });

  it('2: tam eşitlik içermeyi yener ("istinafa cevap": #5 tam, #4 içerme)', () => {
    const m = resolveRuleByAlias('istinafa cevap', 'hmk', RULES);
    expect(m.status === 'matched' && m.rule.code).toBe('hmk_istinaf_cevap');
  });

  it('3: dal süzgeci: "istinaf" ceza kolunda HMK kuralı seçmez; tekil içerme eşleşir', () => {
    const m = resolveRuleByAlias('ceza istinaf başvurusu', 'cmk', RULES);
    expect(m.status === 'matched' && m.rule.code).toBe('cmk_istinaf');
    expect(m.status === 'matched' && m.score).toBe(50);
  });

  it('4: eşitlik aday listeli belirsizlik döner (model tahmin etmez)', () => {
    // "istinaf" (#4) ve "istinaf cevap" (#5) ikisi de metinde içerme ile geçer -> 50/50.
    const m = resolveRuleByAlias('istinaf cevap ve istinaf', 'hmk', RULES);
    expect(m.status).toBe('ambiguous');
    if (m.status !== 'matched') {
      expect(m.candidates.map((c) => c.code).sort()).toEqual([
        'hmk_istinaf_basvuru',
        'hmk_istinaf_cevap',
      ]);
    }
  });

  it('5: skor 0 aday listeli bulunamadı döner; kural kodu argümanı eşleşme sayılmaz', () => {
    const m = resolveRuleByAlias('hmk_istinaf_basvuru', 'hmk', RULES);
    expect(m.status).toBe('not_found');
    if (m.status !== 'matched')
      expect(m.candidates.length).toBe(RULES.filter((r) => r.branch === 'hmk').length);
    expect(resolveRuleByAlias('kira tespiti', 'hmk', RULES).status).toBe('not_found');
  });

  it('yalnız verilen (seçilebilir) kurallar adaydır', () => {
    expect(resolveRuleByAlias('istinaf', 'hmk', []).status).toBe('not_found');
  });

  it('içerme sözcük sınırına bakar', () => {
    expect(aliasScore('temyiz', 'temyiz')).toBe(100);
    expect(aliasScore('temyizden vazgeçme', 'temyiz')).toBe(0);
    expect(aliasScore('temyiz başvurusu nasıl', 'temyiz başvurusu')).toBe(50);
  });
});

describe('KK-P22-27 (083 §7.2) evrak türünden kural adayı (saf işlev)', () => {
  it('tablo sırası; yargı koluna göre süzülür', () => {
    expect(candidatesForDocType('decision', null, RULES)).toEqual([
      'hmk_istinaf_basvuru',
      'hmk_temyiz_basvuru',
      'iyuk_istinaf',
      'iyuk_temyiz',
      'cmk_istinaf',
      'cmk_temyiz',
    ]);
    expect(candidatesForDocType('decision', 'cmk', RULES)).toEqual(['cmk_istinaf', 'cmk_temyiz']);
    expect(candidatesForDocType('petition', 'hmk', RULES)).toEqual(['hmk_cevap_dilekcesi']);
  });

  it('aday yok: iddianame, tutanak ve diğerleri', () => {
    for (const t of ['indictment', 'minutes', 'contract', 'other'] as const) {
      expect(candidatesForDocType(t, null, RULES)).toEqual([]);
    }
  });

  it('yalnız seçilebilir (doğrulanmış) kurallar aday olur', () => {
    const only = RULES.filter((r) => r.code === 'iik_imzaya_itiraz');
    expect(candidatesForDocType('service_notice', null, only)).toEqual(['iik_imzaya_itiraz']);
    expect(candidatesForDocType('service_notice', null, [])).toEqual([]);
  });
});
