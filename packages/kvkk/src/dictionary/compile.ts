// Sözlük otomatı (026 §7.3): kendi Aho-Corasick uygulaması (yeni npm bağımlılığı yok). Girdi foldChars
// sonrası UTF-16 kod birimleridir; özdeş yüzeyler birleştirilir; ekleme sırası (yüzey, tip, kimlik)
// sıralıdır (determinizm). Derleme O(toplam yüzey uzunluğu), tarama O(n + eşleşme).

import { COMMON_WORDS } from '../data/common-words.tr.ts';
import { KvkkMaskingError } from '../errors.ts';
import { foldChars, isIgnorableCode, isWhitespaceCode } from '../fold.ts';
import { resolveLimits } from '../limits.ts';
import { canon } from '../tokens/canon.ts';
import { utf8 } from '../tokens/derive.ts';
import { sealSerialization } from '../tokens/table.ts';
import {
  type CompiledDictionary,
  DICTIONARY_INTERNAL,
  type DictionaryOptions,
  type DictionarySource,
  type KvkkLimits,
  type Tip,
} from '../types.ts';

/** Genel Aho-Corasick otomatı (sözlük, sözlükçe, anahtar sözcük kümeleri). */
export class Automaton {
  readonly #goto = new Map<number, number>();
  readonly #fail: number[] = [0];
  readonly #out = new Map<number, number[]>();
  readonly #dictLink: number[] = [-1];
  readonly #children: number[][] = [[]];
  readonly #edge: number[] = [0];
  readonly lengths: number[] = [];

  constructor(patterns: readonly string[]) {
    patterns.forEach((p, id) => {
      this.#insert(p, id);
    });
    this.#build();
  }

  #insert(p: string, id: number): void {
    let node = 0;
    for (let i = 0; i < p.length; i += 1) {
      const c = p.charCodeAt(i);
      const key = node * 0x10000 + c;
      let next = this.#goto.get(key);
      if (next === undefined) {
        next = this.#fail.length;
        this.#goto.set(key, next);
        this.#fail.push(0);
        this.#dictLink.push(-1);
        this.#children.push([]);
        this.#edge.push(c);
        this.#children[node]?.push(next);
      }
      node = next;
    }
    const out = this.#out.get(node);
    if (out) out.push(id);
    else this.#out.set(node, [id]);
    this.lengths[id] = p.length;
  }

  #build(): void {
    const queue: number[] = [];
    for (const child of this.#children[0] ?? []) {
      this.#fail[child] = 0;
      queue.push(child);
    }
    for (let qi = 0; qi < queue.length; qi += 1) {
      const u = queue[qi] ?? 0;
      for (const v of this.#children[u] ?? []) {
        const c = this.#edge[v] ?? 0;
        let f = this.#fail[u] ?? 0;
        let target = this.#goto.get(f * 0x10000 + c);
        while (target === undefined && f !== 0) {
          f = this.#fail[f] ?? 0;
          target = this.#goto.get(f * 0x10000 + c);
        }
        this.#fail[v] = target !== undefined && target !== v ? target : 0;
        const fv = this.#fail[v] ?? 0;
        this.#dictLink[v] = this.#out.has(fv) ? fv : (this.#dictLink[fv] ?? -1);
        queue.push(v);
      }
    }
  }

  /** Her eşleşme için (başlangıç, bitiş, desen) çağrılır; bitiş hariçtir. */
  scan(text: string, onMatch: (start: number, end: number, id: number) => void): void {
    let state = 0;
    for (let i = 0; i < text.length; i += 1) {
      const c = text.charCodeAt(i);
      let next = this.#goto.get(state * 0x10000 + c);
      while (next === undefined && state !== 0) {
        state = this.#fail[state] ?? 0;
        next = this.#goto.get(state * 0x10000 + c);
      }
      state = next ?? 0;
      let node = this.#out.has(state) ? state : (this.#dictLink[state] ?? -1);
      while (node > 0) {
        for (const id of this.#out.get(node) ?? []) {
          const len = this.lengths[id] ?? 0;
          onMatch(i + 1 - len, i + 1, id);
        }
        node = this.#dictLink[node] ?? -1;
      }
    }
  }
}

/** Otomat anahtarı: foldChars, sıfır genişlikliler atılmış, boşluk dizisi tek ' ', kırpılmış. */
export function surfaceKey(surface: string): string {
  const f = foldChars(surface);
  let out = '';
  let pendingSpace = false;
  for (let i = 0; i < f.length; i += 1) {
    const c = surface.charCodeAt(i);
    if (isIgnorableCode(c)) continue;
    if (isWhitespaceCode(c)) {
      pendingSpace = out.length > 0;
      continue;
    }
    if (pendingSpace) out += ' ';
    pendingSpace = false;
    out += f.charAt(i);
  }
  return out;
}

const STRUCTURED: ReadonlySet<Tip> = new Set(['TCKN', 'VKN', 'TEL', 'EPOSTA', 'IBAN']);
const COMMON = new Set(COMMON_WORDS.map((w) => foldChars(w)));

export interface SurfacePayload {
  tip: Tip;
  identity: string;
  display: string;
  ambiguous: boolean;
  /** Tek sözcüklü yüzey: şekil kuralı (TITLE/UPPER) uygulanır (026 §7.3 kural 3). */
  single: boolean;
  weak: boolean;
}

export interface DictionaryCore {
  automaton: Automaton;
  keys: readonly string[];
  payloads: readonly SurfacePayload[];
}

export interface SurfaceRecord {
  tip: Tip;
  identity: string;
  display: string;
  surface: string;
}

/** Kayıtları otomata derler; aynı yüzey >= 2 kimlikte ise belirsiz işaretlenir (026 §7.2). */
export function buildCore(records: readonly SurfaceRecord[]): DictionaryCore {
  const groups = new Map<string, SurfaceRecord[]>();
  for (const r of records) {
    const key = surfaceKey(r.surface);
    if (key.length === 0) continue;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }
  const keys = [...groups.keys()].sort();
  const payloads: SurfacePayload[] = [];
  for (const key of keys) {
    const g = (groups.get(key) ?? []).slice().sort((a, b) => {
      const ka = `${a.tip}\u0000${a.identity}`;
      const kb = `${b.tip}\u0000${b.identity}`;
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    const first = g[0] as SurfaceRecord;
    const ids = new Set(g.map((r) => `${r.tip}\u0000${r.identity}`));
    const ambiguous = ids.size > 1;
    const single = !key.includes(' ');
    payloads.push({
      tip: first.tip,
      identity: ambiguous ? canon(first.tip, first.surface) : first.identity,
      display: ambiguous ? '' : first.display,
      ambiguous,
      single,
      weak: single && COMMON.has(key),
    });
  }
  return { automaton: new Automaton(keys), keys, payloads };
}

export interface DictionaryInternal {
  core: DictionaryCore;
  /** `${tip}:${canon}` -> kimlik ve kimlik -> görünen değer (yapısal algılayıcı eşlemesi). */
  canonMap: Map<string, string>;
  displays: Map<string, string>;
}

const DICT_LABEL = 'eda/kvkk/dict/v1';

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function compileDictionary(
  sources: readonly DictionarySource[],
  opts: DictionaryOptions,
): CompiledDictionary {
  const limits: KvkkLimits = resolveLimits(opts.limits);
  const records: SurfaceRecord[] = [];
  const canonMap = new Map<string, string>();
  const displays = new Map<string, string>();
  const seen = new Set<string>();
  const serial: string[] = [];
  for (const s of sources) {
    displays.set(`${s.tip}\u0000${s.identity}`, s.display);
    for (const surface of s.surfaces) {
      const dedupe = `${s.tip}\u0000${s.identity}\u0000${surface}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      records.push({ tip: s.tip, identity: s.identity, display: s.display, surface });
      serial.push(`${s.tip}\u0001${s.identity}\u0001${s.display}\u0001${surfaceKey(surface)}`);
      if (STRUCTURED.has(s.tip)) canonMap.set(`${s.tip}:${canon(s.tip, surface)}`, s.identity);
    }
  }
  if (records.length > limits.dictionaryMaxSurfaces) {
    throw new KvkkMaskingError('DICTIONARY_UNAVAILABLE', { count: records.length });
  }
  serial.sort();
  let version: string;
  try {
    version = hex(opts.crypto.hmacSha256(utf8(DICT_LABEL), utf8(serial.join('\n')))).slice(0, 8);
  } catch {
    throw new KvkkMaskingError('INTERNAL');
  }
  const core = buildCore(records);
  const ambiguous = new Set<string>();
  core.keys.forEach((k, i) => {
    if (core.payloads[i]?.ambiguous) ambiguous.add(k);
  });
  const internal: DictionaryInternal = { core, canonMap, displays };
  const ids = new Set(sources.map((s) => `${s.tip}\u0000${s.identity}`));
  const dict: CompiledDictionary = {
    version,
    entries: ids.size,
    surfaces: core.keys.length,
    canonMap,
    ambiguous,
    [DICTIONARY_INTERNAL]: internal,
  };
  return sealSerialization(dict);
}

/** Derlenmiş sözlüğün iç yapısı; bozuk/yabancı nesne DICTIONARY_UNAVAILABLE (fail-closed). */
export function dictionaryInternal(dict: CompiledDictionary): DictionaryInternal {
  const internal = dict[DICTIONARY_INTERNAL] as DictionaryInternal | undefined;
  if (!internal || !(internal.core?.automaton instanceof Automaton)) {
    throw new KvkkMaskingError('DICTIONARY_UNAVAILABLE');
  }
  return internal;
}
