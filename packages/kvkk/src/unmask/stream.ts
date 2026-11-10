// Akış geri çözücü (026 §9.2-§9.4, 022 §6.2): parça kimliği başına tampon; `[` görülünce token grameri
// sınanır, gramerle uyumlu yarım dilim (en çok 33 karakter: 20 + kesme + 12) beklemede kalır; diğer metin
// gecikmesiz akar. Kararlar yalnız metne bağlıdır: her parçalama için akışsız `unmaskText` ile bayt eşit
// (KK-022-4). Bilinmeyen token olduğu gibi kalır; URL/bağlantı/kod içinde çözme yoktur.
import { isLetterChar } from '../fold.ts';
import { harmonize } from '../suffix/harmonize.ts';
import { matchTokenAt } from '../tokens/grammar.ts';
import { sealSerialization } from '../tokens/table.ts';
import type { TurnMaskTableView, Unmasker, UnmaskOptions, UnmaskStats } from '../types.ts';
import { type GuardState, newGuardState, prefixAt, urlPrefixAt } from './markdown-guard.ts';

const SUFFIX_MAX_LETTERS = 12;

interface PartState {
  pending: string;
  guard: GuardState;
}

type Suffix =
  | { kind: 'none' }
  | { kind: 'partial' }
  | { kind: 'some'; apostrophe: string; letters: string; end: number };

function readSuffix(s: string, j: number, final: boolean): Suffix {
  if (j >= s.length) return final ? { kind: 'none' } : { kind: 'partial' };
  const ap = s.charAt(j);
  if (ap !== "'" && ap !== '’') return { kind: 'none' };
  let k = j + 1;
  while (k < s.length && k - j - 1 < SUFFIX_MAX_LETTERS && isLetterChar(s.charAt(k))) k += 1;
  const n = k - j - 1;
  if (k >= s.length && n < SUFFIX_MAX_LETTERS && !final) return { kind: 'partial' };
  if (n === 0) return { kind: 'none' };
  return { kind: 'some', apostrophe: ap, letters: s.slice(j + 1, k), end: k };
}

function process(
  st: PartState,
  buf: string,
  final: boolean,
  table: TurnMaskTableView,
  opts: Required<UnmaskOptions>,
  stats: UnmaskStats,
): { out: string; consumed: number } {
  const g = st.guard;
  let out = '';
  let i = 0;
  const emit = (s: string): void => {
    if (s.length === 0) return;
    out += s;
    g.atLineStart = s.charAt(s.length - 1) === '\n';
  };
  while (i < buf.length) {
    const ch = buf.charAt(i);
    // Kod çiti (satır başında ```), çit içinde ve dışında.
    if (g.atLineStart && ch === '`' && !g.inline && !g.link && !g.url) {
      const r = prefixAt(buf, i, '```', final);
      if (r === 'partial') break;
      if (r === 'complete') {
        emit('```');
        g.fence = !g.fence;
        i += 3;
        continue;
      }
    }
    if (g.fence) {
      emit(ch);
      i += 1;
      continue;
    }
    if (g.inline) {
      emit(ch);
      if (ch === '`' || ch === '\n') g.inline = false;
      i += 1;
      continue;
    }
    if (g.link) {
      emit(ch);
      if (ch === ')' || ch === '\n') g.link = false;
      i += 1;
      continue;
    }
    if (g.url) {
      if (ch === ' ' || ch === '\n' || ch === '\t' || ch === ')' || ch === '>') g.url = false;
      else {
        emit(ch);
        i += 1;
        continue;
      }
    }
    if (ch === '`') {
      g.inline = true;
      emit(ch);
      i += 1;
      continue;
    }
    if (ch === ']') {
      if (i + 1 >= buf.length && !final) break;
      if (buf.charAt(i + 1) === '(') {
        emit('](');
        g.link = true;
        i += 2;
        continue;
      }
      emit(ch);
      i += 1;
      continue;
    }
    if (ch === 'h' || ch === 'H') {
      const u = urlPrefixAt(buf, i, final);
      if (u === 'partial') break;
      if (u > 0) {
        emit(buf.slice(i, i + u));
        g.url = true;
        i += u;
        continue;
      }
    }
    if (ch === '[') {
      const m = matchTokenAt(buf, i, final);
      if (m.kind === 'partial') break;
      if (m.kind === 'complete') {
        const entry = table.get(m.token);
        if (!entry) {
          stats.unknown += 1;
          emit(buf.slice(i, m.end));
          i = m.end;
          continue;
        }
        const sfx = opts.harmonize ? readSuffix(buf, m.end, final) : ({ kind: 'none' } as const);
        if (sfx.kind === 'partial') break;
        stats.unmasked += 1;
        if (sfx.kind === 'some') {
          const h = harmonize(entry.display, entry.tip, sfx.letters, sfx.apostrophe);
          if (!h.parsed) stats.suffixUnparsed += 1;
          emit(h.text);
          i = sfx.end;
        } else {
          emit(entry.display);
          i = m.end;
        }
        g.atLineStart = false;
        continue;
      }
    }
    emit(ch);
    i += 1;
  }
  return { out, consumed: i };
}

export function createUnmasker(table: TurnMaskTableView, options: UnmaskOptions = {}): Unmasker {
  const opts: Required<UnmaskOptions> = { harmonize: options.harmonize ?? true };
  const parts = new Map<string, PartState>();
  const stats: UnmaskStats = { unmasked: 0, unknown: 0, suffixUnparsed: 0 };
  const stateOf = (id: string): PartState => {
    let st = parts.get(id);
    if (!st) {
      st = { pending: '', guard: newGuardState() };
      parts.set(id, st);
    }
    return st;
  };
  const unmasker: Unmasker = {
    push(partId: string, delta: string): string {
      const st = stateOf(partId);
      const buf = st.pending + delta;
      const r = process(st, buf, false, table, opts, stats);
      st.pending = buf.slice(r.consumed);
      return r.out;
    },
    end(partId: string): string {
      const st = parts.get(partId);
      if (!st) return '';
      const r = process(st, st.pending, true, table, opts, stats);
      parts.delete(partId);
      return r.out;
    },
    endAll(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const id of [...parts.keys()].sort()) out[id] = unmasker.end(id);
      return out;
    },
    stats,
  };
  return sealSerialization(unmasker);
}

/** Akışsız karşılık; her parçalama için akış sonucuyla bayt eşittir (026 §9.8). */
export function unmaskText(
  text: string,
  table: TurnMaskTableView,
  options?: UnmaskOptions,
): string {
  const u = createUnmasker(table, options);
  return u.push('_', text) + u.end('_');
}
