// Maskeleme geçişi `mask()` (026 §7.6.1): saf, deterministik, kapatılamaz. Aynı girdi + aynı anahtar +
// aynı MASKER_VERSION + aynı sözlük sürümü = aynı bayt. Hata kısmi çıktı DÖNDÜRMEZ; KvkkMaskingError
// yükselir (fail-closed). Eşleme tablosu yalnız dönen nesnede, tur ömründe bellekte tutulur (Y-19).
import { type Candidate, StepBudget } from './detectors/candidate.ts';
import { resolveCandidates } from './detectors/resolve.ts';
import { type DictionaryInternal, dictionaryInternal } from './dictionary/compile.ts';
import { buildLearned } from './dictionary/learned.ts';
import { type OriginPolicy, policyFor } from './dictionary/origin-policy.ts';
import { scanCore } from './dictionary/scan.ts';
import { asMaskingError, KvkkMaskingError } from './errors.ts';
import { escapedRanges, escapeTokenLike } from './escape.ts';
import { isAllUpper, isTrUpper } from './fold.ts';
import { resolveLimits } from './limits.ts';
import { buildScan, type NormText, normalizeText, type ScanText } from './normalize.ts';
import { collectCandidates } from './pipeline.ts';
import { canon } from './tokens/canon.ts';
import { formatToken, tokenHash } from './tokens/derive.ts';
import { tokenRegex } from './tokens/grammar.ts';
import { sealSerialization, TurnMaskTable } from './tokens/table.ts';
import {
  emptyTipCounts,
  type KvkkLimits,
  type MaskedSegmentResult,
  type MaskInput,
  type MaskResult,
  type SpanRecord,
  type Tip,
} from './types.ts';
import { MASKER_VERSION } from './version.ts';

export const MASK_META: unique symbol = Symbol('eda.kvkk.maskMeta');

export interface MaskMeta {
  maskOwnCaseNumber: boolean;
}

interface Prepared {
  index: number;
  id: string;
  origin: MaskInput['segments'][number]['origin'];
  protected: boolean;
  preMasked: boolean;
  norm: NormText;
  occupied: Uint8Array;
  scan: ScanText;
  policy: OriginPolicy;
  candidates: Candidate[];
  accepted: Candidate[];
}

const PASS_ROUNDS = 3;

function markRanges(target: Uint8Array, ranges: readonly [number, number][]): void {
  for (const [s, e] of ranges) for (let i = s; i < e; i += 1) target[i] = 1;
}

function protectedRanges(text: string, preMasked: boolean): [number, number][] {
  const out = escapedRanges(text);
  if (preMasked) {
    for (const m of text.matchAll(tokenRegex())) out.push([m.index, m.index + m[0].length]);
  }
  return out;
}

function cacheKey(seg: Prepared, dictVersion: string, raw: string, ownCase: boolean): string {
  return [
    MASKER_VERSION,
    dictVersion,
    seg.origin,
    seg.preMasked ? '1' : '0',
    ownCase ? '1' : '0',
    raw,
  ].join('\u0000');
}

function isTitleish(s: string): boolean {
  const first = s.charAt(0);
  return isTrUpper(first) && !isAllUpper(s);
}

interface Assigned {
  candidate: Candidate;
  tip: Tip;
  identity: string;
  surface: string;
}

/** Saf, deterministik maskeleme; beklenmeyen istisna INTERNAL (kısmi çıktı yok). */
export function mask(input: MaskInput): MaskResult {
  try {
    return maskInner(input);
  } catch (e) {
    throw asMaskingError(e, 'INTERNAL');
  }
}

function maskInner(input: MaskInput): MaskResult {
  const t0 = input.clock ? input.clock() : 0;
  const limits: KvkkLimits = resolveLimits(input.limits);
  const total = input.segments.reduce((n, s) => n + s.text.length, 0);
  if (total > limits.maskInputMaxChars) {
    throw new KvkkMaskingError('INPUT_TOO_LARGE', { count: total });
  }
  const dict: DictionaryInternal | null = input.dictionary
    ? dictionaryInternal(input.dictionary)
    : null;
  const dictVersion = input.dictionary?.version ?? '-';
  const ownCase = input.options.maskOwnCaseNumber;
  const budget = new StepBudget(limits.windowBudgetFactor * Math.max(total, 64));
  let escapedCount = 0;

  // 0-3: koruma, kaçışlama, NFC + katlama, geçiş 1 adayları.
  const prepared: Prepared[] = input.segments.map((seg, index) => {
    const isProtected = seg.protected === true;
    const preMasked = seg.preMasked === true && !isProtected;
    let text = seg.text;
    if (!isProtected && !preMasked) {
      const esc = escapeTokenLike(text);
      text = esc.text;
      escapedCount += esc.escaped;
    }
    const norm = isProtected ? { orig: text, fold: text } : normalizeText(text);
    const occupied = new Uint8Array(norm.orig.length);
    if (!isProtected) markRanges(occupied, protectedRanges(norm.orig, preMasked));
    const scan = isProtected
      ? { fold: '', orig: '', pos: new Uint32Array(1), nfcLength: 0 }
      : buildScan(norm, occupied);
    const policy = policyFor(seg.origin);
    const p: Prepared = {
      index,
      id: seg.id,
      origin: seg.origin,
      protected: isProtected,
      preMasked,
      norm,
      occupied,
      scan,
      policy,
      candidates: [],
      accepted: [],
    };
    if (isProtected) return p;
    const key = input.cache ? cacheKey(p, dictVersion, seg.text, ownCase) : null;
    const cached =
      key && input.cache ? (input.cache.get(key) as Candidate[] | undefined) : undefined;
    if (cached) {
      p.candidates = cached.map((c) => ({ ...c }));
    } else {
      p.candidates = collectCandidates(scan, {
        policy,
        dict,
        maskOwnCaseNumber: ownCase,
        limits,
        budget,
        level: 'full',
        segmentId: seg.id,
      });
      if (key && input.cache)
        input.cache.set(
          key,
          p.candidates.map((c) => ({ ...c })),
        );
    }
    return p;
  });

  try {
    // 4: öğrenilen yüzey (geçiş 1'de kabul edilmiş sözlük dışı KISI/SIRKET).
    const learnedSeed: { candidate: Candidate; text: string }[] = [];
    for (const p of prepared) {
      if (p.protected) continue;
      const first = resolveCandidates(p.candidates, p.norm.orig.length, p.occupied);
      for (const c of first) {
        if (c.source === 'heuristic' && (c.tip === 'KISI' || c.tip === 'SIRKET')) {
          learnedSeed.push({ candidate: c, text: p.norm.orig.slice(c.start, c.end) });
        }
      }
    }
    const learned = buildLearned(learnedSeed, limits);
    // 5: geçiş 2 + çakışma çözümü; artık tarama (doğrulayıcının göreceği kalan yüzeyler) en çok 3 tur.
    for (const p of prepared) {
      if (p.protected) continue;
      const all = [...p.candidates];
      if (learned.core && p.policy.learned) {
        all.push(
          ...scanCore(p.scan, learned.core, {
            source: 'learned',
            priority: 95,
            allowDosya: false,
            suffixMaxLetters: limits.suffixMaxLetters,
          }),
        );
      }
      p.accepted = resolveCandidates(all, p.norm.orig.length, p.occupied);
      for (let round = 0; round < PASS_ROUNDS; round += 1) {
        const blank = p.occupied.slice();
        for (const c of p.accepted) for (let i = c.start; i < c.end; i += 1) blank[i] = 1;
        const residual = collectCandidates(buildScan(p.norm, blank), {
          policy: p.policy,
          dict,
          maskOwnCaseNumber: ownCase,
          limits,
          budget,
          level: 'strict-structural',
          segmentId: p.id,
        });
        if (residual.length === 0) break;
        const extra = resolveCandidates(residual, p.norm.orig.length, blank);
        if (extra.length === 0) break;
        p.accepted = [...p.accepted, ...extra].sort((a, b) => a.start - b.start);
      }
    }
  } catch (e) {
    throw asMaskingError(e, 'DETECTOR_FAILED');
  }

  // 6: kimlik ata; görünen değer (026 §4.7).
  const assigned: Assigned[][] = prepared.map((p) =>
    p.accepted.map((c) => {
      const surface = p.norm.orig.slice(c.start, c.end);
      let identity = c.identity;
      if (identity === undefined && c.source === 'pattern' && dict) {
        identity = dict.canonMap.get(`${c.tip}:${canon(c.tip, surface)}`);
      }
      if (identity === undefined) identity = canon(c.tip, c.identitySurface ?? surface);
      return { candidate: c, tip: c.tip, identity, surface };
    }),
  );
  const displays = new Map<string, string>();
  const firstSeen = new Map<string, { title?: string; first?: string }>();
  for (const segAssigned of assigned) {
    for (const a of segAssigned) {
      const key = `${a.tip}\u0000${a.identity}`;
      const explicit =
        a.candidate.display ??
        (dict && a.candidate.source === 'pattern' ? dict.displays.get(key) : undefined);
      if (explicit !== undefined && explicit !== '' && !displays.has(key)) {
        displays.set(key, explicit);
        continue;
      }
      const shown = a.candidate.displaySurface ?? a.surface;
      const seen = firstSeen.get(key) ?? {};
      if (seen.first === undefined) seen.first = shown;
      if (seen.title === undefined && isTitleish(shown)) seen.title = shown;
      firstSeen.set(key, seen);
    }
  }
  for (const [key, seen] of firstSeen) {
    if (displays.has(key)) continue;
    displays.set(key, seen.title ?? seen.first ?? '');
  }

  // 6: (tip, kimlik) çiftleri ve çakışma çözümü (026 §4.5).
  const pairs = new Map<string, { tip: Tip; identity: string }>();
  for (const segAssigned of assigned) {
    for (const a of segAssigned)
      pairs.set(`${a.tip}\u0000${a.identity}`, { tip: a.tip, identity: a.identity });
  }
  const keys = [...pairs.keys()].sort();
  const hashes = new Map<string, string>();
  try {
    for (const k of keys) {
      const p = pairs.get(k) as { tip: Tip; identity: string };
      hashes.set(k, tokenHash(input.crypto, input.convKey, p.tip, p.identity));
    }
  } catch {
    throw new KvkkMaskingError('INTERNAL');
  }
  const tokens = new Map<string, string>();
  const base = input.options.tokenHashChars;
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const tip = (pairs.get(k) as { tip: Tip }).tip;
    const h = hashes.get(k) ?? '';
    const g = `${tip}\u0000${h.slice(0, 4)}`;
    const list = groups.get(g) ?? [];
    list.push(k);
    groups.set(g, list);
  }
  for (const k of keys) {
    const tip = (pairs.get(k) as { tip: Tip }).tip;
    const h = hashes.get(k) ?? '';
    const group = groups.get(`${tip}\u0000${h.slice(0, 4)}`) ?? [];
    const n: 4 | 6 = base === 6 || group.length > 1 ? 6 : 4;
    if (group.length > 1) {
      const six = new Set(group.map((x) => (hashes.get(x) ?? '').slice(0, 6)));
      if (six.size < group.length) throw new KvkkMaskingError('TOKEN_COLLISION');
    }
    if (h.length < 6) throw new KvkkMaskingError('INTERNAL');
    tokens.set(k, formatToken(tip, h, n));
  }

  // 7-8: metni yeniden yaz; tablo.
  const table = new TurnMaskTable();
  const byTip = emptyTipCounts();
  let learnedSpans = 0;
  const segments: MaskedSegmentResult[] = prepared.map((p, si) => {
    if (p.protected) {
      return {
        id: p.id,
        origin: p.origin,
        protected: true,
        preMasked: false,
        text: p.norm.orig,
        spans: [],
        nfcLength: p.norm.orig.length,
      };
    }
    let out = '';
    let pos = 0;
    const spans: SpanRecord[] = [];
    for (const a of assigned[si] ?? []) {
      const c = a.candidate;
      const key = `${a.tip}\u0000${a.identity}`;
      const token = tokens.get(key) ?? '';
      out += p.norm.orig.slice(pos, c.start);
      const maskedStart = out.length;
      out += token;
      pos = c.end;
      table.set(token, {
        tip: a.tip,
        display: displays.get(key) ?? a.surface,
        identity: a.identity,
      });
      byTip[a.tip] += 1;
      if (c.source === 'learned') learnedSpans += 1;
      const rec: SpanRecord = {
        start: c.start,
        end: c.end,
        maskedStart,
        maskedEnd: maskedStart + token.length,
        tip: a.tip,
        token,
        source: c.source,
        confidence: c.confidence,
      };
      if (c.weak) rec.weak = true;
      if (c.suffix) rec.suffix = { start: c.suffix.start, end: c.suffix.end };
      spans.push(rec);
    }
    out += p.norm.orig.slice(pos);
    return {
      id: p.id,
      origin: p.origin,
      protected: false,
      preMasked: p.preMasked,
      text: out,
      spans,
      nfcLength: p.norm.orig.length,
    };
  });

  const t1 = input.clock ? input.clock() : 0;
  const result: MaskResult = {
    segments,
    table,
    stats: { byTip, escaped: escapedCount, learned: learnedSpans, ms: Math.max(0, t1 - t0) },
  };
  Object.defineProperty(result, MASK_META, {
    value: { maskOwnCaseNumber: ownCase } satisfies MaskMeta,
    enumerable: false,
  });
  return sealSerialization(result);
}

export function maskMeta(result: MaskResult): MaskMeta {
  const meta = (result as unknown as Record<symbol, MaskMeta | undefined>)[MASK_META];
  return meta ?? { maskOwnCaseNumber: true };
}
