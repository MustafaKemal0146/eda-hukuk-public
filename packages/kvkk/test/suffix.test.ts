// @tk TK-08
// KK-P08-8 (KK-026-13): ek uyumlayıcı altın küme + bağımsız oracle, tip başına >= 500 örnek; doğruluk
// raporlanır (suffix_accuracy[tip]). Oracle ve uyumlayıcı kod paylaşmaz (KK-027-17).
import { describe, expect, it } from 'vitest';
import { harmonize, harmonizeSuffix } from '../src/suffix/harmonize.ts';
import { parseSuffix } from '../src/suffix/parse.ts';
import { generateTails } from '../src/suffix/tails.ts';
import { TIPS } from '../src/types.ts';
import { coreGolden, oracleGolden, SUFFIX_SAMPLES_PER_TIP } from './support/suffix-golden.ts';

const CORE = coreGolden();

describe('KK-P08-8: ek uyumlayıcı çekirdek örnekleri (026 §7.5 (4))', () => {
  it('KK-P08-8 çekirdek altın küme verified=false işaretli', () => {
    expect(CORE.verified).toBe(false);
  });
  for (const r of CORE.records) {
    it(`KK-P08-8 ${r.display} + ${r.writtenSuffix} -> ${r.expected}`, () => {
      expect(harmonizeSuffix(r.display, r.tip, r.writtenSuffix)).toBe(r.expected);
    });
  }

  it('KK-P08-8 kesme işareti yazılandan aynen alınır; çözümlenemeyen ek aynen korunur', () => {
    expect(harmonizeSuffix('Ayşe', 'KISI', 'in', '’')).toBe('Ayşe’nin');
    expect(harmonize('Ayşe', 'KISI', 'qq').parsed).toBe(false);
  });

  it('KK-P08-8 ı/i/u/ü tek başına ACC seçilir ve belirsiz işaretlenir', () => {
    expect(parseSuffix('ı')).toEqual({ chain: ['ACC'], ambiguous: true });
    expect(parseSuffix('sının')).toEqual({ chain: ['POSS3', 'GEN'], ambiguous: false });
    expect(parseSuffix('lerinde')?.chain).toEqual(['PLURAL', 'POSS3', 'LOC']);
  });

  it('KK-P08-8 generateTails: <= 8 harf, <= 64 dizge; Yılmaz örneği', () => {
    const t = generateTails('Yılmaz');
    expect(t.size).toBeLessThanOrEqual(64);
    for (const s of t) expect(s.length).toBeLessThanOrEqual(8);
    for (const s of ['ın', 'a', 'ı', 'da', 'dan', 'la', 'lar', 'ların', 'larda'])
      expect(t.has(s)).toBe(true);
  });
});

describe('KK-P08-8: bağımsız oracle ile tip başına >= 500 örnek (026 §13.5)', () => {
  const golden = oracleGolden(20261011);
  it('KK-P08-8 küme boyutu: 12 tip x 500', () => {
    expect(golden.length).toBe(TIPS.length * SUFFIX_SAMPLES_PER_TIP);
  });
  for (const tip of TIPS) {
    it(`KK-P08-8 suffix_accuracy[${tip}] = 1 (oracle ile uyuşmazlık incelemeye gider)`, () => {
      const rows = golden.filter((g) => g.tip === tip);
      const bad = rows.filter((g) => harmonizeSuffix(g.display, g.tip, g.written) !== g.expected);
      expect(rows.length).toBeGreaterThanOrEqual(500);
      expect(bad.slice(0, 5)).toEqual([]);
    });
  }
});
