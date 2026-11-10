// Ölçüm metrikleri (026 §13.3-§13.4): gizlendi/yakalandı/tip hatası/sızıntı, kesinlik, zor negatif
// yanlış pozitif, kayıt temizliği, zayıf eşleşme, learned_fp, gidiş-dönüş, remask_drift ve Wilson %95.
import { compileDictionary } from '../../src/dictionary/compile.ts';
import { sourcesFromInput } from '../../src/dictionary/from-input.ts';
import { mask } from '../../src/mask.ts';
import type { CryptoPort } from '../../src/ports.ts';
import { mulberry32 } from '../../src/testing.ts';
import { tokenRegex } from '../../src/tokens/grammar.ts';
import type { MaskResult, SpanSource, Tip } from '../../src/types.ts';
import { createUnmasker, unmaskText } from '../../src/unmask/stream.ts';
import type { GoldSpan, MaskingRecord } from './generate.ts';

export type GoldStatus = 'captured' | 'type_error' | 'leak' | 'negative_ok' | 'negative_fp';

export interface ProducedSpan {
  tip: Tip;
  start: number;
  end: number;
  source: SpanSource;
  weak: boolean;
  /** mustMask bir gold aralığıyla örtüşüyor mu (kesinlik). */
  onGold: boolean;
}

export interface RecordOutcome {
  id: string;
  group: string;
  gold: { span: GoldSpan; status: GoldStatus }[];
  produced: ProducedSpan[];
  falsePositives: number;
  roundTrip?: boolean;
  remask?: { drift: boolean; byteDiff: boolean };
  /** adversarial.token_like: kaçışlanmış dizi geri çözmede çözüldü mü (S5 ihlali). */
  tokenLikeResolved?: boolean;
  error?: string;
}

export interface EvalContext {
  crypto: CryptoPort;
  convKey: Uint8Array;
  seed: number;
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function tokenSequence(text: string, result: MaskResult): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(tokenRegex())) {
    const e = result.table.get(m[0]);
    out.push(e ? `${e.tip}:${e.identity}` : `?:${m[0]}`);
  }
  return out;
}

function chunked(text: string, result: MaskResult, rnd: () => number): string {
  const u = createUnmasker(result.table);
  let out = '';
  let i = 0;
  while (i < text.length) {
    const len = 1 + Math.floor(rnd() * 9);
    out += u.push('p', text.slice(i, i + len));
    i += len;
  }
  return out + u.end('p');
}

export function evaluateRecord(rec: MaskingRecord, ctx: EvalContext): RecordOutcome {
  const dict = compileDictionary(
    sourcesFromInput(rec.input.dictionary, {
      maskOwnCaseNumber: rec.input.options.maskOwnCaseNumber,
    }),
    { crypto: ctx.crypto },
  );
  const run = (text: string): MaskResult =>
    mask({
      segments: [{ id: rec.id, text, origin: rec.input.origin }],
      convKey: ctx.convKey,
      dictionary: dict,
      options: rec.input.options,
      crypto: ctx.crypto,
    });
  let result: MaskResult;
  try {
    result = run(rec.input.text);
  } catch (e) {
    return {
      id: rec.id,
      group: rec.group,
      gold: rec.expected.spans.map((span) => ({
        span,
        status: span.mustMask ? 'leak' : 'negative_ok',
      })),
      produced: [],
      falsePositives: 0,
      error: e instanceof Error ? e.name : 'hata',
    };
  }
  const seg = result.segments[0];
  const spans = seg?.spans ?? [];
  const must = rec.expected.spans.filter((g) => g.mustMask);
  const produced: ProducedSpan[] = spans.map((s) => ({
    tip: s.tip,
    start: s.start,
    end: s.end,
    source: s.source,
    weak: s.weak === true,
    onGold: must.some((g) => overlaps(g, s)),
  }));
  const gold = rec.expected.spans.map((g) => {
    if (!g.mustMask) {
      const hit = spans.some((s) => overlaps(g, s));
      return { span: g, status: (hit ? 'negative_fp' : 'negative_ok') as GoldStatus };
    }
    const covering = spans.filter((s) => overlaps(g, s));
    let covered = true;
    for (let i = g.start; i < g.end && covered; i += 1) {
      if (!covering.some((s) => s.start <= i && i < s.end)) covered = false;
    }
    if (!covered) return { span: g, status: 'leak' as GoldStatus };
    const one = covering.length === 1 ? covering[0] : undefined;
    const entry = one ? result.table.get(one.token) : undefined;
    const ok =
      one !== undefined &&
      one.tip === g.tip &&
      (g.identity === null || entry?.identity === g.identity);
    return { span: g, status: (ok ? 'captured' : 'type_error') as GoldStatus };
  });
  const outcome: RecordOutcome = {
    id: rec.id,
    group: rec.group,
    gold,
    produced,
    falsePositives: produced.filter((p) => !p.onGold).length,
  };
  const rt = rec.expected.roundTrip;
  if (rt) {
    const m = /\{\{T:([^}]{1,80})\}\}/u.exec(rt.modelOutputTemplate);
    const identity = m?.[1] ?? '';
    const token = result.table.tokens().find((t) => result.table.get(t)?.identity === identity);
    if (!token) {
      outcome.roundTrip = false;
    } else {
      const o = rt.modelOutputTemplate.replace(`{{T:${identity}}}`, token);
      const plain = unmaskText(o, result.table);
      const stream = chunked(o, result, mulberry32(ctx.seed ^ plain.length));
      outcome.roundTrip = plain === rt.expectedUnmasked && stream === rt.expectedUnmasked;
      const again = run(plain);
      const o2 = again.segments[0]?.text ?? '';
      outcome.remask = {
        drift: tokenSequence(o, result).join('|') !== tokenSequence(o2, again).join('|'),
        byteDiff: o2 !== o,
      };
    }
  }
  if (rec.group === 'adversarial.token_like') {
    outcome.tokenLikeResolved = unmaskText(seg?.text ?? '', result.table) !== (seg?.text ?? '');
  }
  return outcome;
}

/** Wilson %95 puan aralığı (026 §13.6). */
export function wilson(k: number, n: number, z = 1.959964): { lower: number; upper: number } {
  if (n === 0) return { lower: 0, upper: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lower: Math.max(0, (center - margin) / denom),
    upper: Math.min(1, (center + margin) / denom),
  };
}

export interface RateRow {
  n: number;
  captured: number;
  leak: number;
  typeError: number;
  captureRate: number;
  leakRate: number;
  typeErrorRate: number;
  captureWilsonLower: number;
}

function rateRow(statuses: readonly GoldStatus[]): RateRow {
  const n = statuses.length;
  const captured = statuses.filter((s) => s === 'captured').length;
  const leak = statuses.filter((s) => s === 'leak').length;
  const typeError = statuses.filter((s) => s === 'type_error').length;
  return {
    n,
    captured,
    leak,
    typeError,
    captureRate: n ? captured / n : 0,
    leakRate: n ? leak / n : 0,
    typeErrorRate: n ? typeError / n : 0,
    captureWilsonLower: wilson(captured, n).lower,
  };
}

export interface Summary {
  records: number;
  byTip: Record<
    string,
    RateRow & { precision: number; produced: number; fpRateWilsonUpper: number }
  >;
  byGroup: Record<string, RateRow>;
  nameForms: Record<string, RateRow>;
  missedNameForms: { group: string; leak: number; n: number }[];
  negativeHardFpRate: number;
  negativeHardFpWilsonUpper: number;
  negativeHardN: number;
  adversarialLeakRate: number;
  tokenLikeResolved: number;
  corpusOriginViolations: number;
  recordCleanRate: number;
  weakMatchRate: number;
  learnedFp: number;
  roundtripIdentityRate: number;
  roundtripN: number;
  remaskDrift: number;
  remaskByteDiffRate: number;
  errors: number;
}

export function summarize(outcomes: readonly RecordOutcome[]): Summary {
  const byTipStatus = new Map<string, GoldStatus[]>();
  const byGroupStatus = new Map<string, GoldStatus[]>();
  const negatives: GoldStatus[] = [];
  for (const o of outcomes) {
    for (const g of o.gold) {
      if (!g.span.mustMask) {
        if (o.group === 'negative_hard') negatives.push(g.status);
        continue;
      }
      const tip = g.span.tip ?? '-';
      byTipStatus.set(tip, [...(byTipStatus.get(tip) ?? []), g.status]);
      byGroupStatus.set(o.group, [...(byGroupStatus.get(o.group) ?? []), g.status]);
    }
  }
  const produced = outcomes.flatMap((o) => o.produced);
  const byTip: Summary['byTip'] = {};
  for (const [tip, st] of [...byTipStatus.entries()].sort()) {
    const mine = produced.filter((p) => p.tip === tip);
    const onGold = mine.filter((p) => p.onGold).length;
    byTip[tip] = {
      ...rateRow(st),
      produced: mine.length,
      precision: mine.length ? onGold / mine.length : 1,
      fpRateWilsonUpper: wilson(mine.length - onGold, mine.length).upper,
    };
  }
  const byGroup: Summary['byGroup'] = {};
  for (const [group, st] of [...byGroupStatus.entries()].sort()) byGroup[group] = rateRow(st);
  const nameForms: Summary['nameForms'] = {};
  for (const [group, row] of Object.entries(byGroup)) {
    if (group.startsWith('KISI.')) nameForms[group.slice(5)] = row;
  }
  const missedNameForms = Object.entries(nameForms)
    .filter(([, r]) => r.leak > 0)
    .map(([group, r]) => ({ group, leak: r.leak, n: r.n }));
  const negFp = negatives.filter((s) => s === 'negative_fp').length;
  const adv = outcomes.filter((o) => o.group.startsWith('adversarial.'));
  const advGold = adv.flatMap((o) => o.gold.filter((g) => g.span.mustMask));
  const corpus = outcomes.filter((o) => o.group.startsWith('corpus_origin.'));
  const corpusViolations = corpus.filter((o) =>
    o.gold.some((g) => (g.span.mustMask ? g.status !== 'captured' : g.status === 'negative_fp')),
  ).length;
  const clean = outcomes.filter(
    (o) =>
      o.falsePositives === 0 &&
      o.gold.every((g) => g.status === 'captured' || g.status === 'negative_ok'),
  ).length;
  const rts = outcomes.filter((o) => o.roundTrip !== undefined);
  const remask = outcomes.filter((o) => o.remask !== undefined);
  return {
    records: outcomes.length,
    byTip,
    byGroup,
    nameForms,
    missedNameForms,
    negativeHardFpRate: negatives.length ? negFp / negatives.length : 0,
    negativeHardFpWilsonUpper: wilson(negFp, negatives.length).upper,
    negativeHardN: negatives.length,
    adversarialLeakRate: advGold.length
      ? advGold.filter((g) => g.status === 'leak').length / advGold.length
      : 0,
    tokenLikeResolved: adv.filter((o) => o.tokenLikeResolved === true).length,
    corpusOriginViolations: corpusViolations,
    recordCleanRate: outcomes.length ? clean / outcomes.length : 0,
    weakMatchRate: produced.length ? produced.filter((p) => p.weak).length / produced.length : 0,
    learnedFp: produced.filter((p) => p.source === 'learned' && !p.onGold).length,
    roundtripIdentityRate: rts.length ? rts.filter((o) => o.roundTrip).length / rts.length : 1,
    roundtripN: rts.length,
    remaskDrift: remask.length ? remask.filter((o) => o.remask?.drift).length / remask.length : 0,
    remaskByteDiffRate: remask.length
      ? remask.filter((o) => o.remask?.byteDiff).length / remask.length
      : 0,
    errors: outcomes.filter((o) => o.error !== undefined).length,
  };
}
