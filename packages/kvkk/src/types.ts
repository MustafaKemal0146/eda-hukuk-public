// Paket tipleri (026 §1.2, §6.1, §7). Tip kodları ve köken türleri 002 §11.8 / 020 Origin.kind
// kanonundan (@eda/contracts) gelir; burada yeniden yazılmaz.
import {
  MASKING_ORIGIN_KINDS,
  MASKING_TYPE_CODES,
  type MaskingOriginKind,
  type MaskingTypeCode,
  type PartyRole,
  type SensitiveTopicCode,
} from '@eda/contracts/enums';
import type { ClockPort, CryptoPort } from './ports.ts';

export type Tip = MaskingTypeCode;
export type OriginKind = MaskingOriginKind;
export type { PartyRole, SensitiveTopicCode };
export const TIPS: readonly Tip[] = MASKING_TYPE_CODES;
export const ORIGIN_KINDS: readonly OriginKind[] = MASKING_ORIGIN_KINDS;

export type SpanSource = 'dict' | 'learned' | 'pattern' | 'lexicon' | 'heuristic';
export type Confidence = 'high' | 'medium';

/** Sağlayıcıya gidecek sırayla tek geçişte maskelenen içerik parçası. */
export interface MaskSegment {
  id: string;
  text: string;
  origin: OriginKind;
  /** Yalnız katman [1] (sabit direktif): aynen kopyalanır. */
  protected?: boolean;
  /**
   * Model tarafından maskeli hâlde üretilmiş ve geri çözülmeden geri gönderilen metin (imzalı
   * reasoning): kaçışlama yapılmaz, gramere uyan tokenlar korunur, algılayıcılar kalan
   * metinde yine çalışır.
   */
  preMasked?: boolean;
}

export interface MaskOptions {
  tokenHashChars: 4 | 6;
  maskOwnCaseNumber: boolean;
}

/** 026 §10.2 sınırları; varsayılanlar 002 §7.1 (`kvkk.*`). Testler küçültebilir, büyütemez değil. */
export interface KvkkLimits {
  maskInputMaxChars: number;
  windowBudgetFactor: number;
  learnedMaxSurfaces: number;
  dictionaryMaxSurfaces: number;
  nameMaxWords: number;
  addressMaxChars: number;
  weakVariantMinChars: number;
  suffixMaxLetters: number;
}

export interface MaskInput {
  segments: readonly MaskSegment[];
  convKey: Uint8Array;
  /** null = tasarım gereği boş sözlük (büro dışı görev, public sınıf; 026 §12.3). */
  dictionary: CompiledDictionary | null;
  options: MaskOptions;
  crypto: CryptoPort;
  limits?: Partial<KvkkLimits>;
  /** Tur ömürlü segment önbelleği (026 §11.3); çıktıyı değiştirmez. */
  cache?: SegmentCache;
  clock?: ClockPort;
}

export interface SpanRecord {
  /** Özgün NFC metindeki aralık (ek hariç). */
  start: number;
  end: number;
  /** Maskeli metindeki token aralığı. */
  maskedStart: number;
  maskedEnd: number;
  tip: Tip;
  token: string;
  source: SpanSource;
  confidence: Confidence;
  weak?: boolean;
  /** Token ardında yazıldığı gibi bırakılan ek (özgün NFC ofsetleri). */
  suffix?: { start: number; end: number };
}

export interface MaskedSegmentResult {
  id: string;
  origin: OriginKind;
  protected: boolean;
  preMasked: boolean;
  /** Maskeli metin. */
  text: string;
  spans: SpanRecord[];
  /** NFC sonrası özgün metin uzunluğu (ofset sınaması için). */
  nfcLength: number;
}

export type TipCounts = Record<Tip, number>;

export interface MaskStats {
  byTip: TipCounts;
  escaped: number;
  learned: number;
  ms: number;
}

export interface MaskResult {
  segments: MaskedSegmentResult[];
  table: TurnMaskTableView;
  stats: MaskStats;
}

export interface TurnMaskEntry {
  tip: Tip;
  display: string;
  identity: string;
}

/** Salt-okur tablo görünümü (token -> değer); yalnız tur ömrü, bellekte (Y-19). */
export interface TurnMaskTableView {
  readonly size: number;
  get(token: string): TurnMaskEntry | undefined;
  tokens(): string[];
}

export interface VerifyHit {
  segmentId: string;
  tip: Tip | null;
  kind: 'surface' | 'unknown_token';
  start: number;
  end: number;
}

export interface VerifyReport {
  ok: boolean;
  hits: VerifyHit[];
}

export interface Detection {
  tip: Tip;
  start: number;
  end: number;
  confidence: Confidence;
  source: SpanSource;
}

export interface DetectOptions {
  level: 'standard' | 'strict';
  dictionary?: CompiledDictionary | null;
  origin?: OriginKind;
}

export interface UnmaskOptions {
  /** Ek okunur ve uyumlanır (varsayılan açık). */
  harmonize?: boolean;
}

export interface UnmaskStats {
  unmasked: number;
  unknown: number;
  suffixUnparsed: number;
}

export interface Unmasker {
  push(partId: string, delta: string): string;
  end(partId: string): string;
  endAll(): Record<string, string>;
  readonly stats: UnmaskStats;
}

/** 026 §7.1 sözlük girdisi (api/worker RLS altında okuyup çözer; paket DB'ye erişmez). */
export interface DictionaryInput {
  clients: {
    id: string;
    kind: 'person' | 'entity';
    firstName?: string;
    lastName?: string;
    entityName?: string;
    aliases?: string[];
    tckn?: string;
    vkn?: string;
    email?: string;
    phone?: string;
    address?: string;
  }[];
  parties: {
    id: string;
    clientId: string | null;
    role: PartyRole;
    kind: 'person' | 'entity';
    firstName?: string;
    lastName?: string;
    entityName?: string;
    counselName?: string | null;
    address?: string;
  }[];
  cases: { id: string; esasNo?: string; kararNo?: string; officeFileCode?: string }[];
}

export interface DictionarySource {
  ownerId: string;
  tip: Tip;
  identity: string;
  display: string;
  surfaces: string[];
}

export interface DictionaryOptions {
  crypto: CryptoPort;
  limits?: Partial<KvkkLimits>;
}

export const DICTIONARY_INTERNAL: unique symbol = Symbol('eda.kvkk.dictionary');

export interface CompiledDictionary {
  readonly version: string;
  readonly entries: number;
  readonly surfaces: number;
  readonly canonMap: ReadonlyMap<string, string>;
  readonly ambiguous: ReadonlySet<string>;
  readonly [DICTIONARY_INTERNAL]: unknown;
}

/** Tur ömürlü önbellek (026 §11.3): anahtar segment metni + köken + sözlük sürümü + MASKER_VERSION. */
export interface SegmentCache {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function emptyTipCounts(): TipCounts {
  const out = {} as TipCounts;
  for (const t of TIPS) out[t] = 0;
  return out;
}
