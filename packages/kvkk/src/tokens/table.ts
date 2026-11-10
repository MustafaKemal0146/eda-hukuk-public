// TurnMaskTable (026 §7.6.4): token -> { tip, display, identity }; yalnız tur ömründe bellekte tutulur
// (Y-19). JSON.stringify ve util.inspect içerik sızdırmaz ("[REDACTED]").
import type { TurnMaskEntry, TurnMaskTableView } from '../types.ts';
import { canonicalToken } from './grammar.ts';

export const REDACTED = '[REDACTED]';
const INSPECT = Symbol.for('nodejs.util.inspect.custom');

export class TurnMaskTable implements TurnMaskTableView {
  readonly #entries = new Map<string, TurnMaskEntry>();

  set(token: string, entry: TurnMaskEntry): void {
    this.#entries.set(canonicalToken(token), Object.freeze({ ...entry }));
  }

  get(token: string): TurnMaskEntry | undefined {
    return this.#entries.get(canonicalToken(token));
  }

  get size(): number {
    return this.#entries.size;
  }

  tokens(): string[] {
    return [...this.#entries.keys()].sort();
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [INSPECT](): string {
    return REDACTED;
  }
}

/** Nesneye içerik sızdırmayan toJSON/inspect ekler (MaskResult, Unmasker, sözlük). */
export function sealSerialization<T extends object>(obj: T): T {
  Object.defineProperty(obj, 'toJSON', { value: () => REDACTED, enumerable: false });
  Object.defineProperty(obj, INSPECT, { value: () => REDACTED, enumerable: false });
  return obj;
}
