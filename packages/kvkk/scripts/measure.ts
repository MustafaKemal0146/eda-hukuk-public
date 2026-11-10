// Maskeleme ölçüm betiği (026 §11, §13; 027 §8; KK-P08-12). Sentetik küme üretir, ölçer, raporu
// (JSON + Markdown) test/report/ altına yazar (gitignore) ve başlangıç değerlerini
// test/thresholds.baseline.json'a kaydeder. Eşik DEĞİLDİR: değerler hukuk/ürün onayı bekler (026 §14).
// Kullanım: pnpm --filter @eda/kvkk measure [--seed N] [--write-smoke]
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { compileDictionary } from '../src/dictionary/compile.ts';
import { sourcesFromInput } from '../src/dictionary/from-input.ts';
import { mask } from '../src/mask.ts';
import { harmonizeSuffix } from '../src/suffix/harmonize.ts';
import { SyntheticGen } from '../src/testing.ts';
import { deriveConvKey } from '../src/tokens/derive.ts';
import { TIPS } from '../src/types.ts';
import { createUnmasker } from '../src/unmask/stream.ts';
import { verifyMasked } from '../src/verify.ts';
import { MASKER_VERSION } from '../src/version.ts';
import { CORPUS_TOOL, FULL_SIZES, generateCorpus, smokeSubset } from '../test/corpus/generate.ts';
import { evaluateRecord, type Summary, summarize, wilson } from '../test/corpus/metrics.ts';
import { nodeCryptoPort, TEST_KEY, TEST_SCOPE } from '../test/support/node-crypto-port.ts';
import { coreGolden, oracleGolden } from '../test/support/suffix-golden.ts';

const args = process.argv.slice(2);
const seedArg = args.indexOf('--seed');
const SEED = seedArg >= 0 ? Number(args[seedArg + 1]) : 20261011;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

function pct(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
}

function timeit(fn: () => void, warmup = 3, reps = 30): number[] {
  for (let i = 0; i < warmup; i += 1) fn();
  const out: number[] = [];
  for (let i = 0; i < reps; i += 1) {
    const t = performance.now();
    fn();
    out.push(performance.now() - t);
  }
  return out;
}

export interface SuffixAccuracy {
  byTip: Record<string, { n: number; correct: number; accuracy: number }>;
  core: { n: number; correct: number; verified: boolean };
}

export function suffixAccuracy(seed: number): SuffixAccuracy {
  const byTip: SuffixAccuracy['byTip'] = {};
  for (const r of oracleGolden(seed)) {
    const row = byTip[r.tip] ?? { n: 0, correct: 0, accuracy: 0 };
    row.n += 1;
    if (harmonizeSuffix(r.display, r.tip, r.written) === r.expected) row.correct += 1;
    row.accuracy = row.correct / row.n;
    byTip[r.tip] = row;
  }
  const core = coreGolden();
  const correct = core.records.filter(
    (r) => harmonizeSuffix(r.display, r.tip, r.writtenSuffix) === r.expected,
  ).length;
  return { byTip, core: { n: core.records.length, correct, verified: core.verified } };
}

export interface PerfReport {
  cpu: string;
  maskP50Ms10k: number;
  maskP95Ms10k: number;
  verifyP95Ms10k: number;
  compileP95Ms1k: number;
  unmaskPushP95Ms: number;
  harmonizeP95Ms: number;
}

export function performanceReport(seed: number): PerfReport {
  const g = new SyntheticGen(seed);
  const clients = Array.from({ length: 500 }, (_, i) => ({
    id: `c${i}`,
    kind: 'person' as const,
    firstName: g.givenName(),
    lastName: g.surname(),
    tckn: g.tckn(),
    email: g.email(),
  }));
  const dict = compileDictionary(
    sourcesFromInput({ clients, parties: [], cases: [] }, { maskOwnCaseNumber: true }),
    { crypto: nodeCryptoPort },
  );
  let text = '';
  while (text.length < 10_000) {
    const c = g.pick(clients);
    text += `Müvekkil ${c.firstName} ${c.lastName} (TC ${c.tckn}) ${g.phone().text} numarasından aradı; `;
    text +=
      'kira bedelinin tespiti ve tahliye talebi Yargıtay 3. HD 2023/118 E. kararına dayanır. ';
  }
  text = text.slice(0, 10_000);
  const convKey = deriveConvKey(nodeCryptoPort, TEST_KEY, TEST_SCOPE);
  const run = () =>
    mask({
      segments: [{ id: 's', text, origin: 'user_text' }],
      convKey,
      dictionary: dict,
      options: { tokenHashChars: 4, maskOwnCaseNumber: true },
      crypto: nodeCryptoPort,
    });
  const maskTimes = timeit(run);
  const result = run();
  const verifyTimes = timeit(() => verifyMasked(result, dict));
  const bigClients = Array.from({ length: 1000 }, (_, i) => ({
    id: `b${i}`,
    kind: 'person' as const,
    firstName: g.givenName(),
    lastName: g.surname(),
  }));
  const compileTimes = timeit(() =>
    compileDictionary(
      sourcesFromInput(
        { clients: bigClients, parties: [], cases: [] },
        { maskOwnCaseNumber: true },
      ),
      { crypto: nodeCryptoPort },
    ),
  );
  const masked = result.segments[0]?.text ?? '';
  const pushTimes: number[] = [];
  const u = createUnmasker(result.table);
  for (let i = 0; i < masked.length; i += 24) {
    const t = performance.now();
    u.push('p', masked.slice(i, i + 24));
    pushTimes.push(performance.now() - t);
  }
  u.end('p');
  const harmTimes = timeit(() => harmonizeSuffix('Ahmet Yılmaz', 'KISI', 'in'), 100, 1000);
  return {
    cpu: cpus()[0]?.model ?? 'bilinmiyor',
    maskP50Ms10k: pct(maskTimes, 50),
    maskP95Ms10k: pct(maskTimes, 95),
    verifyP95Ms10k: pct(verifyTimes, 95),
    compileP95Ms1k: pct(compileTimes, 95),
    unmaskPushP95Ms: pct(pushTimes, 95),
    harmonizeP95Ms: pct(harmTimes, 95),
  };
}

export interface MeasureReport {
  seed: number;
  maskerVersion: string;
  corpusTool: string;
  sizes: typeof FULL_SIZES;
  summary: Summary;
  suffix: SuffixAccuracy;
  perf: PerfReport | null;
}

export function measure(
  seed: number,
  opts: { perf: boolean; sizes?: typeof FULL_SIZES },
): MeasureReport {
  const sizes = opts.sizes ?? FULL_SIZES;
  const records = generateCorpus(seed, sizes);
  const convKey = deriveConvKey(nodeCryptoPort, TEST_KEY, TEST_SCOPE);
  const outcomes = records.map((r) => evaluateRecord(r, { crypto: nodeCryptoPort, convKey, seed }));
  return {
    seed,
    maskerVersion: MASKER_VERSION,
    corpusTool: CORPUS_TOOL,
    sizes,
    summary: summarize(outcomes),
    suffix: suffixAccuracy(seed),
    perf: opts.perf ? performanceReport(seed) : null,
  };
}

const f4 = (x: number): string => x.toFixed(4);

export function markdown(r: MeasureReport): string {
  const s = r.summary;
  const lines: string[] = [];
  lines.push('# KVKK maskeleme ölçüm raporu (sentetik küme)');
  lines.push('');
  lines.push(
    `Tohum ${r.seed}, MASKER_VERSION ${r.maskerVersion}, küme ${r.corpusTool}, ${s.records} kayıt. ` +
      'Değerler başlangıç ölçümüdür; eşik değildir (026 §14, hukuk/ürün onayı bekler). ' +
      'Maskeleme takma adlaştırmadır; maskelenmiş veri kişisel veri olmaya devam eder.',
  );
  lines.push('');
  lines.push('## Tip bazlı yakalama (Wilson %95 alt sınırı)');
  lines.push('');
  lines.push('| Tip | n | capture | Wilson alt | leak | type_error | precision | FP Wilson üst |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const [tip, row] of Object.entries(s.byTip)) {
    lines.push(
      `| ${tip} | ${row.n} | ${f4(row.captureRate)} | ${f4(row.captureWilsonLower)} | ${f4(row.leakRate)} | ${f4(row.typeErrorRate)} | ${f4(row.precision)} | ${f4(row.fpRateWilsonUpper)} |`,
    );
  }
  lines.push('');
  lines.push('## Ad biçimleri (ayrı satırlar)');
  lines.push('');
  lines.push('| Biçim | n | capture | Wilson alt | leak |');
  lines.push('|---|---|---|---|---|');
  for (const [form, row] of Object.entries(s.nameForms)) {
    lines.push(
      `| ${form} | ${row.n} | ${f4(row.captureRate)} | ${f4(row.captureWilsonLower)} | ${row.leak} |`,
    );
  }
  lines.push('');
  lines.push('## Kaçan ad biçimleri');
  lines.push('');
  if (s.missedNameForms.length === 0)
    lines.push('- Bu kümede kaçan ad biçimi gözlenmedi (0 gözlem, 0 olasılık değildir).');
  for (const m of s.missedNameForms) lines.push(`- ${m.group}: ${m.leak}/${m.n} kaçak`);
  lines.push('');
  lines.push('## Grup bazlı');
  lines.push('');
  lines.push('| Grup | n | capture | leak | type_error |');
  lines.push('|---|---|---|---|---|');
  for (const [g, row] of Object.entries(s.byGroup)) {
    lines.push(`| ${g} | ${row.n} | ${f4(row.captureRate)} | ${row.leak} | ${row.typeError} |`);
  }
  lines.push('');
  lines.push('## Diğer metrikler');
  lines.push('');
  lines.push(
    `- negative_hard_fp_rate: ${f4(s.negativeHardFpRate)} (n=${s.negativeHardN}, Wilson üst ${f4(s.negativeHardFpWilsonUpper)})`,
  );
  lines.push(
    `- adversarial leak_rate: ${f4(s.adversarialLeakRate)}; çözülen kaçışlanmış dizi (S5): ${s.tokenLikeResolved}`,
  );
  lines.push(`- corpus_origin ihlali (S4): ${s.corpusOriginViolations}`);
  lines.push(`- record_clean_rate: ${f4(s.recordCleanRate)}`);
  lines.push(`- weak_match_rate: ${f4(s.weakMatchRate)}; learned_fp: ${s.learnedFp}`);
  lines.push(`- roundtrip_identity_rate: ${f4(s.roundtripIdentityRate)} (n=${s.roundtripN})`);
  lines.push(
    `- remask_drift: ${f4(s.remaskDrift)}; remask_byte_diff_rate: ${f4(s.remaskByteDiffRate)}`,
  );
  lines.push(`- maskeleme hatası (fail-closed) kayıt sayısı: ${s.errors}`);
  lines.push('');
  lines.push('## Ek uyumlayıcı (suffix_accuracy)');
  lines.push('');
  lines.push('| Tip | n | doğru | accuracy |');
  lines.push('|---|---|---|---|');
  for (const tip of TIPS) {
    const row = r.suffix.byTip[tip];
    if (row) lines.push(`| ${tip} | ${row.n} | ${row.correct} | ${f4(row.accuracy)} |`);
  }
  lines.push('');
  lines.push(
    `Çekirdek (elle, verified=${String(r.suffix.core.verified)}): ${r.suffix.core.correct}/${r.suffix.core.n}. ` +
      'Oracle kümesi bağımsız tablo uygulamasıyla üretilmiştir; dil uzmanı doğrulaması bekler.',
  );
  if (r.perf) {
    lines.push('');
    lines.push('## Performans (R sınıfı; 3 ısınma, 30 tekrar)');
    lines.push('');
    lines.push(`- CPU: ${r.perf.cpu}`);
    lines.push(
      `- ms_per_10k (mask p50): ${r.perf.maskP50Ms10k.toFixed(2)}; p95: ${r.perf.maskP95Ms10k.toFixed(2)}`,
    );
    lines.push(`- verifyMasked p95 (10K): ${r.perf.verifyP95Ms10k.toFixed(2)}`);
    lines.push(`- compileDictionary p95 (~1K müvekkil): ${r.perf.compileP95Ms1k.toFixed(2)}`);
    lines.push(
      `- createUnmasker.push p95 (24 karakter parça): ${r.perf.unmaskPushP95Ms.toFixed(4)}`,
    );
    lines.push(`- harmonizeSuffix p95: ${r.perf.harmonizeP95Ms.toFixed(4)}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Başlangıç değeri dosyası (026 §14.3; P08 E2): nihai eşik değildir. */
export function baseline(r: MeasureReport): unknown {
  const s = r.summary;
  return {
    suite: 'kvkk_masking',
    status: 'baseline',
    note: 'Ölçülen başlangıç değerleri; eşik değildir. Hukuk/ürün onayı ve P32 thresholds.json bekler (026 §14, AS-0153).',
    seed: r.seed,
    corpusTool: r.corpusTool,
    sizes: r.sizes,
    hard: {
      roundtripIdentityRate: s.roundtripIdentityRate,
      corpusOriginViolations: s.corpusOriginViolations,
      tokenLikeResolved: s.tokenLikeResolved,
    },
    captureByTip: Object.fromEntries(
      Object.entries(s.byTip).map(([t, row]) => [
        t,
        {
          n: row.n,
          captureRate: row.captureRate,
          wilsonLower: row.captureWilsonLower,
          precision: row.precision,
        },
      ]),
    ),
    nameForms: Object.fromEntries(
      Object.entries(s.nameForms).map(([f, row]) => [
        f,
        { n: row.n, captureRate: row.captureRate, leak: row.leak },
      ]),
    ),
    negativeHardFpRate: s.negativeHardFpRate,
    adversarialLeakRate: s.adversarialLeakRate,
    recordCleanRate: s.recordCleanRate,
    remaskDrift: s.remaskDrift,
    suffixAccuracy: Object.fromEntries(
      Object.entries(r.suffix.byTip).map(([t, v]) => [t, v.accuracy]),
    ),
  };
}

if (import.meta.main) {
  const report = measure(SEED, { perf: true });
  const outDir = `${ROOT}test/report`;
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/kvkk-masking-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(`${outDir}/kvkk-masking-report.md`, markdown(report));
  writeFileSync(
    `${ROOT}test/thresholds.baseline.json`,
    `${JSON.stringify(baseline(report), null, 2)}\n`,
  );
  if (args.includes('--write-smoke')) {
    const smoke = smokeSubset(generateCorpus(SEED));
    writeFileSync(
      `${ROOT}test/corpus/smoke.jsonl`,
      `${smoke.map((x) => JSON.stringify(x)).join('\n')}\n`,
    );
  }
  const s = report.summary;
  const tipLine = Object.entries(s.byTip)
    .map(
      ([t, row]) => `${t}=${row.captureRate.toFixed(3)}(alt ${row.captureWilsonLower.toFixed(3)})`,
    )
    .join(' ');
  process.stdout.write(
    `kvkk measure: ${s.records} kayıt, MASKER_VERSION ${report.maskerVersion}\n` +
      `capture: ${tipLine}\n` +
      `negative_hard_fp_rate=${s.negativeHardFpRate.toFixed(4)} roundtrip=${s.roundtripIdentityRate.toFixed(4)} ` +
      `S4=${s.corpusOriginViolations} S5=${s.tokenLikeResolved} remask_drift=${s.remaskDrift.toFixed(4)}\n` +
      `rapor: ${outDir}/kvkk-masking-report.{json,md}\n`,
  );
  const wl = wilson(200, 200).lower;
  process.stdout.write(`(not: n=200, 0 kaçakta yakalama Wilson alt sınırı ${wl.toFixed(3)})\n`);
}
