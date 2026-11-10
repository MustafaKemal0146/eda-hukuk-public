// @tk TK-08
// KK-P08-12 (KK-026-19, KK-026-20): ölçüm betiği rapor üretir — tip başına capture/leak/fp, ad
// biçimleri ayrı, Wilson alt sınırı, roundtrip, suffix, ms/10K; el hesaplı mini kümede (>= 20 kayıt)
// 026 §13.4 formülleri birebir; duman alt kümesinde sert bileşenler (S3, S4, S5) ihlalsiz.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { baseline, markdown, measure } from '../scripts/measure.ts';
import { tcknFromPrefix } from '../src/checksums/tckn.ts';
import { deriveConvKey } from '../src/tokens/derive.ts';
import { TIPS } from '../src/types.ts';
import type { GoldSpan, MaskingRecord } from './corpus/generate.ts';
import { evaluateRecord, summarize, wilson } from './corpus/metrics.ts';
import { nodeCryptoPort, TEST_KEY, TEST_SCOPE } from './support/node-crypto-port.ts';

const CTX = {
  crypto: nodeCryptoPort,
  convKey: deriveConvKey(nodeCryptoPort, TEST_KEY, TEST_SCOPE),
  seed: 1,
};

function rec(
  id: string,
  group: string,
  text: string,
  spans: GoldSpan[],
  dict?: MaskingRecord['input']['dictionary'],
): MaskingRecord {
  return {
    v: 1,
    id,
    set: 'masking',
    group,
    split: 'gate',
    status: 'draft',
    provenance: { kind: 'synthetic_generated', tool: 'el', seed: 0 },
    input: {
      origin: 'user_text',
      text,
      dictionary: dict ?? { clients: [], parties: [], cases: [] },
      options: { maskOwnCaseNumber: true, tokenHashChars: 4 },
    },
    expected: { spans },
  };
}

function gold(
  text: string,
  value: string,
  tip: GoldSpan['tip'],
  mustMask = true,
  identity: string | null = null,
): GoldSpan {
  const start = text.indexOf(value);
  return { start, end: start + value.length, tip, identity, mustMask };
}

/** El hesaplı mini küme (24 kayıt). */
function miniSet(): MaskingRecord[] {
  const out: MaskingRecord[] = [];
  const tckn = ['100000001', '100000002', '100000003', '100000004'].map(tcknFromPrefix);
  // 10 yakalanan TCKN.
  for (let i = 0; i < 10; i += 1) {
    const v = tckn[i % tckn.length] as string;
    const t = `Kimlik ${v} kayıtlı.`;
    out.push(rec(`t${i}`, 'TCKN.mini', t, [gold(t, v, 'TCKN')]));
  }
  // 4 küçük harfli yalnız soyad: sözlükte var, şekil kuralı gereği kaçar (leak).
  const dict = {
    clients: [{ id: 'c1', kind: 'person' as const, firstName: 'Ahmet', lastName: 'Kurtsoy' }],
    parties: [],
    cases: [],
  };
  for (let i = 0; i < 4; i += 1) {
    const t = `dosyayı kurtsoy getirdi ${i}.`;
    out.push(rec(`l${i}`, 'KISI.lowercase', t, [gold(t, 'kurtsoy', 'KISI', true, 'c1')], dict));
  }
  // 2 tip hatası: gold TEL der, değer TCKN olarak gizlenir.
  for (let i = 0; i < 2; i += 1) {
    const t = `Numara 10000000146 (${i}).`;
    out.push(rec(`e${i}`, 'TEL.mini', t, [gold(t, '10000000146', 'TEL')]));
  }
  // 5 zor negatif: 4 temiz, 1 yanlış pozitif (gold dışı ama maskelenen e-posta).
  for (let i = 0; i < 4; i += 1) {
    const t = `Yargıtay ${i + 1}. Hukuk Dairesi kararı.`;
    out.push(
      rec(`n${i}`, 'negative_hard', t, [gold(t, `Yargıtay ${i + 1}. Hukuk Dairesi`, null, false)]),
    );
  }
  const fpText = 'İletişim a@example.com adresi.';
  out.push(rec('n4', 'negative_hard', fpText, [gold(fpText, 'a@example.com', null, false)]));
  // 3 kayıt: gold'u olmayan ek yanlış pozitif (kayıt temiz değil), 1 tanesi gold'lu.
  const extra = 'Kimlik 10000000146 ve tel 0532 123 45 67.';
  out.push(rec('x0', 'TCKN.mini', extra, [gold(extra, '10000000146', 'TCKN')]));
  for (let i = 1; i < 3; i += 1) {
    const t = `Not ${i}: tel 0532 123 45 67.`;
    out.push(rec(`x${i}`, 'misc', t, []));
  }
  return out;
}

describe('KK-P08-12: metrik formülleri el hesaplı mini kümede (026 §13.4, KK-026-20)', () => {
  const outcomes = miniSet().map((r) => evaluateRecord(r, CTX));
  const s = summarize(outcomes);

  it('KK-P08-12 mini küme >= 20 kayıt', () => {
    expect(outcomes.length).toBeGreaterThanOrEqual(20);
    expect(s.errors).toBe(0);
  });

  it('KK-P08-12 capture/leak/type_error tip bazlı (capture + leak + type_error = 1)', () => {
    expect(s.byTip.TCKN).toMatchObject({
      n: 11,
      captured: 11,
      leak: 0,
      typeError: 0,
      captureRate: 1,
    });
    expect(s.byTip.KISI).toMatchObject({ n: 4, captured: 0, leak: 4, captureRate: 0, leakRate: 1 });
    expect(s.byTip.TEL).toMatchObject({
      n: 2,
      captured: 0,
      leak: 0,
      typeError: 2,
      typeErrorRate: 1,
    });
    for (const row of Object.values(s.byTip)) {
      expect(row.captureRate + row.leakRate + row.typeErrorRate).toBeCloseTo(1, 10);
    }
  });

  it('KK-P08-12 precision: üretilen TCKN tokenlarından gold ile örtüşenler', () => {
    // 11 TCKN gold'lu + 2 tip hatası kaydında TCKN olarak gizlenen (TEL gold'u ile örtüşür) = 13/13.
    expect(s.byTip.TCKN?.precision).toBe(1);
  });

  it('KK-P08-12 negative_hard_fp_rate = 1/5; Wilson üst sınırı', () => {
    expect(s.negativeHardN).toBe(5);
    expect(s.negativeHardFpRate).toBeCloseTo(0.2, 10);
    expect(s.negativeHardFpWilsonUpper).toBeCloseTo(wilson(1, 5).upper, 10);
  });

  it('KK-P08-12 record_clean_rate: temiz kayıtlar / tüm kayıtlar', () => {
    // Temiz: 10 TCKN + 4 negatif = 14; kirli: 4 leak + 2 tip hatası + 1 FP negatif + 3 ek FP = 10.
    expect(s.recordCleanRate).toBeCloseTo(14 / 24, 10);
  });

  it('KK-P08-12 ad biçimleri ayrı satırda; kaçan biçim raporlanır', () => {
    expect(s.nameForms.lowercase).toMatchObject({ n: 4, leak: 4 });
    expect(s.missedNameForms).toEqual([{ group: 'lowercase', leak: 4, n: 4 }]);
  });

  it('KK-P08-12 Wilson %95 (026 §13.6 örnek değerleri)', () => {
    expect(wilson(200, 200).lower).toBeCloseTo(0.981, 3);
    expect(wilson(199, 200).lower).toBeCloseTo(0.972, 3);
    expect(wilson(198, 200).lower).toBeCloseTo(0.964, 3);
    expect(wilson(195, 200).lower).toBeCloseTo(0.943, 3);
  });
});

describe('KK-P08-12: duman alt kümesi (test/corpus/smoke.jsonl)', () => {
  const lines = readFileSync(new URL('./corpus/smoke.jsonl', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as MaskingRecord);
  const s = summarize(lines.map((r) => evaluateRecord(r, CTX)));

  it('KK-P08-12 duman kümesi sentetik ve 027 §4.4 biçiminde', () => {
    expect(lines.length).toBeGreaterThanOrEqual(200);
    for (const r of lines) {
      expect(r.provenance.kind).toBe('synthetic_generated');
      expect(r.set).toBe('masking');
    }
    const emails = lines.flatMap((r) => r.input.text.match(/[\w.+-]{1,64}@[\w.-]{1,64}/gu) ?? []);
    for (const e of emails) expect(e).toMatch(/@(example\.(com|org)|[\w-]{1,32}\.test)$/u);
  });

  it('KK-P08-12 sert bileşenler: roundtrip = 1, köken ihlali 0, çözülen kaçışlanmış dizi 0', () => {
    expect(s.roundtripIdentityRate).toBe(1);
    expect(s.corpusOriginViolations).toBe(0);
    expect(s.tokenLikeResolved).toBe(0);
    expect(s.errors).toBe(0);
  });
});

describe('KK-P08-12: rapor ve baseline (küçük küme)', () => {
  const report = measure(7, {
    perf: false,
    sizes: { perTip: 20, negativeHard: 30, adversarial: 12, corpusOrigin: 10 },
  });

  it('KK-P08-12 rapor tip bazlı, ad biçimleri ayrı, suffix 12 tip, MASKER_VERSION', () => {
    expect(Object.keys(report.summary.byTip).sort()).toEqual([...TIPS].sort());
    expect(Object.keys(report.summary.nameForms).length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(report.suffix.byTip).sort()).toEqual([...TIPS].sort());
    expect(report.maskerVersion).toMatch(/\+[0-9a-f]{8}$/u);
    const md = markdown(report);
    for (const h of [
      'Tip bazlı yakalama',
      'Ad biçimleri',
      'Kaçan ad biçimleri',
      'Wilson',
      'suffix_accuracy',
      'roundtrip_identity_rate',
      'remask_drift',
    ]) {
      expect(md).toContain(h);
    }
    // Rapor ham içerik taşımaz: kayıt metinleri rapora girmez.
    expect(md).not.toMatch(/Müvekkil|@example/u);
  });

  it('KK-P08-12 baseline eşik değildir ve sert bileşenleri içerir', () => {
    const b = baseline(report) as { status: string; hard: Record<string, number> };
    expect(b.status).toBe('baseline');
    expect(b.hard).toEqual({
      roundtripIdentityRate: 1,
      corpusOriginViolations: 0,
      tokenLikeResolved: 0,
    });
    const committed = JSON.parse(
      readFileSync(new URL('./thresholds.baseline.json', import.meta.url), 'utf8'),
    ) as { status: string; suite: string };
    expect(committed).toMatchObject({ status: 'baseline', suite: 'kvkk_masking' });
  });
});
