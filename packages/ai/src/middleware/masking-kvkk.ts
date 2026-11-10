// Sohbet adaptörü (026 §7.8, P08.14): KvkkMasker implements MaskerPort. LanguageModelV4Prompt
// segmentlere çevrilir — metin parçaları, reasoning (maskeli üretilmiş; preMasked), araç
// çağrısı girdisinin yalnız dize değerleri, araç sonucu metni/JSON dize değerleri; köken
// providerOptions.eda.origin (yoksa user_text); sistem mesajı (katman [1]) ve araç tanımları korunur.
// K_conv = HKDF(hmac_pseudonym_key, scopeId); sözlük DictionaryProvider portundan (P09b api'de gerçekler;
// okunamazsa DICTIONARY_UNAVAILABLE -> fail-closed). Çıktı markalı istemdir; egress bekçisi doğrular.
import type {
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import {
  type CompiledDictionary,
  type CryptoPort,
  createUnmasker,
  deriveConvKey,
  KvkkMaskingError,
  type MaskResult,
  type MaskSegment,
  mask,
  ORIGIN_KINDS,
  type OriginKind,
  stripTokens,
  type TurnMaskTable,
  unmaskText,
  verifyMasked,
} from '@eda/kvkk';
import type { MaskedTurn, MaskerPort, StreamUnmaskerPort } from './masking.ts';

/** Araç girdisi politikası (026 §9.6, 022 §6.4; 021 §4.16 ile çelişkide 026 geçerli). */
export type ArgsPolicy = 'strip_tokens' | 'unmask' | 'none';

export const TOOL_ARGS_POLICY: Readonly<Record<string, ArgsPolicy>> = {
  search_decisions: 'strip_tokens',
  get_decision: 'strip_tokens',
  search_legislation: 'strip_tokens',
  get_legislation_article: 'strip_tokens',
  search_case_files: 'unmask',
  calculate_deadline: 'unmask',
  create_document: 'unmask',
  edit_document: 'unmask',
  submit_outline: 'unmask',
};

/** Sözlük portu: null = tasarım gereği boş sözlük (büro dışı görev); istisna = okunamadı. */
export interface DictionaryProvider {
  current(): CompiledDictionary | null;
}

export const EMPTY_DICTIONARY: DictionaryProvider = { current: () => null };

export interface KvkkMaskerOptions {
  crypto: CryptoPort;
  /** hmac_pseudonym_key (sır dosyasından; koda/loga yazılmaz). */
  pseudonymKey: Uint8Array;
  /** conversationId (küçük harfli kanonik UUID) veya "file:<id>" / "document:<id>". */
  scopeId: string;
  dictionary: DictionaryProvider;
  /** org_settings.mask_own_case_number (002 §7); varsayılan açık. */
  maskOwnCaseNumber?: boolean;
}

const ORIGINS = new Set<string>(ORIGIN_KINDS);
const HASH_CHARS: number = CONFIG_DEFAULTS['kvkk.tokenHashChars'];

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

interface Slot {
  seg: MaskSegment;
  apply(text: string): void;
}

function edaOrigin(po: unknown): OriginKind | undefined {
  const eda = (po as { eda?: { origin?: unknown } } | undefined)?.eda;
  const o = eda?.origin;
  return typeof o === 'string' && ORIGINS.has(o) ? (o as OriginKind) : undefined;
}

/** `eda` ad alanı sağlayıcıya gitmez. */
function stripEda<T extends object>(x: T): T {
  const po = (x as { providerOptions?: unknown }).providerOptions as
    | Record<string, unknown>
    | undefined;
  if (!po || !('eda' in po)) return x;
  const { eda: _eda, ...rest } = po;
  const copy = { ...x } as T & { providerOptions?: Record<string, unknown> };
  if (Object.keys(rest).length === 0) delete copy.providerOptions;
  else copy.providerOptions = rest;
  return copy;
}

class SegmentCollector {
  readonly slots: Slot[] = [];
  #n = 0;

  text(origin: OriginKind, value: string, apply: (t: string) => void, preMasked = false): void {
    this.#n += 1;
    const seg: MaskSegment = { id: `s${this.#n}`, text: value, origin };
    if (preMasked) seg.preMasked = true;
    this.slots.push({ seg, apply });
  }

  /** JSON değerindeki dize değerleri (anahtarlar, sayılar ve mantıksal değerler dönüştürülmez). */
  json(origin: OriginKind, value: unknown, apply: (v: Json) => void): void {
    if (typeof value === 'string') {
      this.text(origin, value, (t) => apply(t));
      return;
    }
    if (Array.isArray(value)) {
      const out: Json[] = value.map((v) => v as Json);
      value.forEach((v, i) => {
        this.json(origin, v, (nv) => {
          out[i] = nv;
        });
      });
      apply(out);
      return;
    }
    if (value !== null && typeof value === 'object') {
      const out: { [k: string]: Json } = {};
      for (const [k, v] of Object.entries(value)) out[k] = v as Json;
      for (const [k, v] of Object.entries(value)) {
        this.json(origin, v, (nv) => {
          out[k] = nv;
        });
      }
      apply(out);
      return;
    }
    apply(value as Json);
  }
}

function rejectBinary(): never {
  // Maskelenemeyen ikili/URL içerik sağlayıcıya maskesiz gitmez (fail-closed).
  throw new KvkkMaskingError('INTERNAL');
}

function outputSlots(
  c: SegmentCollector,
  out: LanguageModelV4ToolResultOutput,
  origin: OriginKind,
  set: (o: LanguageModelV4ToolResultOutput) => void,
): void {
  const base = stripEda(out);
  switch (base.type) {
    case 'text':
    case 'error-text':
      set(base);
      c.text(origin, base.value, (t) => set({ ...base, value: t }));
      return;
    case 'json':
    case 'error-json':
      set(base);
      c.json(origin, base.value, (v) => set({ ...base, value: v }));
      return;
    case 'execution-denied':
      set(base);
      if (base.reason !== undefined)
        c.text(origin, base.reason, (t) => set({ ...base, reason: t }));
      return;
    case 'content': {
      const items = base.value.map((it) => ({ ...it }));
      set({ ...base, value: items });
      items.forEach((it, i) => {
        if (it.type === 'text') {
          c.text(origin, it.text, (t) => {
            items[i] = { ...it, text: t };
            set({ ...base, value: [...items] });
          });
        } else if (it.type === 'file') {
          if (it.data.type !== 'text') rejectBinary();
          const data = it.data;
          c.text(origin, data.text, (t) => {
            items[i] = { ...it, data: { ...data, text: t } };
            set({ ...base, value: [...items] });
          });
        }
      });
      return;
    }
  }
}

/** İstemi kopyalar ve maskelenecek segment yuvalarını toplar (sistem mesajı korunur). */
function collect(prompt: LanguageModelV4Prompt): { copy: LanguageModelV4Prompt; slots: Slot[] } {
  const c = new SegmentCollector();
  const copy: LanguageModelV4Prompt = prompt.map((m) => stripEda(m));
  copy.forEach((msg, mi) => {
    const msgOrigin = edaOrigin(prompt[mi]?.providerOptions) ?? 'user_text';
    if (msg.role === 'system') return;
    const content = msg.content.map((p) => ({ ...p })) as typeof msg.content;
    (copy[mi] as LanguageModelV4Message) = { ...msg, content } as LanguageModelV4Message;
    content.forEach((part, pi) => {
      const original = part;
      const origin = edaOrigin(original.providerOptions) ?? msgOrigin;
      const put = (np: typeof part) => {
        (content as (typeof part)[])[pi] = np;
      };
      switch (part.type) {
        case 'text': {
          const p = stripEda(part);
          put(p);
          c.text(origin, p.text, (t) => put({ ...p, text: t }));
          break;
        }
        case 'reasoning': {
          const p = stripEda(part);
          put(p);
          c.text('user_text', p.text, (t) => put({ ...p, text: t }), true);
          break;
        }
        case 'file': {
          const p = stripEda(part);
          if (p.data.type !== 'text') rejectBinary();
          const data = p.data;
          let cur = { ...p, data: { ...data } };
          put(cur);
          c.text(origin, data.text, (t) => {
            cur = { ...cur, data: { ...data, text: t } };
            put(cur);
          });
          if (p.filename !== undefined) {
            c.text(origin, p.filename, (t) => {
              cur = { ...cur, filename: t };
              put(cur);
            });
          }
          break;
        }
        case 'reasoning-file':
          rejectBinary();
          break;
        case 'tool-call': {
          // Asistanın araç çağrısı girdisi user_text politikasıyla işlenir (026 §5).
          const p = stripEda(part);
          put(p);
          c.json('user_text', p.input, (v) => put({ ...p, input: v }));
          break;
        }
        case 'tool-result': {
          const p = stripEda(part);
          const o =
            edaOrigin((part.output as { providerOptions?: unknown }).providerOptions) ?? origin;
          let cur = p;
          put(cur);
          outputSlots(c, p.output, o, (out) => {
            cur = { ...cur, output: out };
            put(cur);
          });
          break;
        }
        case 'tool-approval-response': {
          const p = stripEda(part);
          put(p);
          if (p.reason !== undefined) c.text(origin, p.reason, (t) => put({ ...p, reason: t }));
          break;
        }
        default:
          put(stripEda(part));
      }
    });
  });
  return { copy, slots: c.slots };
}

function transformJsonStrings(input: string, fn: (s: string) => string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return fn(input);
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return JSON.stringify(walk(parsed));
}

export class KvkkMasker implements MaskerPort {
  readonly #convKey: Uint8Array;
  readonly #opts: KvkkMaskerOptions;
  #lastMaskedCount: number | null = null;

  constructor(opts: KvkkMaskerOptions) {
    this.#opts = opts;
    try {
      this.#convKey = deriveConvKey(opts.crypto, opts.pseudonymKey, opts.scopeId);
    } catch {
      throw new KvkkMaskingError('INTERNAL');
    }
  }

  /** Son çağrıda maskelenen span sayısı (case_ai_logs.masked_count; içerik yok). */
  get lastMaskedCount(): number | null {
    return this.#lastMaskedCount;
  }

  #dictionary(): CompiledDictionary | null {
    try {
      return this.#opts.dictionary.current();
    } catch {
      throw new KvkkMaskingError('DICTIONARY_UNAVAILABLE');
    }
  }

  mask(prompt: LanguageModelV4Prompt): MaskedTurn {
    const dictionary = this.#dictionary();
    const { copy, slots } = collect(prompt);
    const result = mask({
      segments: slots.map((s) => s.seg),
      convKey: this.#convKey,
      dictionary,
      options: {
        tokenHashChars: HASH_CHARS === 6 ? 6 : 4,
        maskOwnCaseNumber: this.#opts.maskOwnCaseNumber ?? true,
      },
      crypto: this.#opts.crypto,
    });
    result.segments.forEach((seg, i) => {
      slots[i]?.apply(seg.text);
    });
    const count = Object.values(result.stats.byTip).reduce((a, b) => a + b, 0);
    this.#lastMaskedCount = count;
    const table = result.table;
    turnResults.set(copy, { result, dictionary });
    return {
      prompt: copy,
      maskedCount: count,
      createUnmasker: (): StreamUnmaskerPort => createUnmasker(table),
      unmaskText: (text) => unmaskText(text, table),
      transformToolInput: (toolName, input) => transformToolInput(table, toolName, input),
    };
  }

  verify(prompt: LanguageModelV4Prompt, turn: MaskedTurn): boolean {
    const known = turnResults.get(turn.prompt);
    if (!known || turn.prompt !== prompt) return false;
    // Giden istemden segmentler yeniden çıkarılır (önbellek değil, gerçek bayt) ve bağımsız taranır.
    const { slots } = collect(prompt);
    // Köken ve preMasked bilgisi maskeleme anındaki segmentlerden (eda ad alanı giden istemde yok).
    if (slots.length !== known.result.segments.length) return false;
    const view = {
      segments: slots.map((s, i) => ({
        id: s.seg.id,
        origin: known.result.segments[i]?.origin ?? 'user_text',
        protected: false,
        preMasked: known.result.segments[i]?.preMasked === true,
        text: s.seg.text,
        spans: [],
        nfcLength: s.seg.text.length,
      })),
      table: known.result.table,
      stats: known.result.stats,
    } satisfies MaskResult;
    return verifyMasked(view, known.dictionary).ok;
  }
}

const turnResults = new WeakMap<
  LanguageModelV4Prompt,
  { result: MaskResult; dictionary: CompiledDictionary | null }
>();

export function transformToolInput(table: TurnMaskTable, toolName: string, input: string): string {
  const policy = TOOL_ARGS_POLICY[toolName] ?? 'strip_tokens';
  if (policy === 'none') return input;
  if (policy === 'strip_tokens') return transformJsonStrings(input, (s) => stripTokens(s).text);
  return transformJsonStrings(input, (s) => unmaskText(s, table));
}

export function createKvkkMasker(opts: KvkkMaskerOptions): KvkkMasker {
  return new KvkkMasker(opts);
}
