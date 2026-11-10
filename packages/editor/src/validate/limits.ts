// Belge sınırları (054 §2.7): `editor.maxBlocks`, `editor.maxDraftBytes` (002 §7.1).
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';

export type EditorLimits = { maxBlocks: number; maxDraftBytes: number };

export const DEFAULT_EDITOR_LIMITS: EditorLimits = {
  maxBlocks: CONFIG_DEFAULTS['editor.maxBlocks'],
  maxDraftBytes: CONFIG_DEFAULTS['editor.maxDraftBytes'],
};

/** JSON gövdesinin UTF-8 bayt uzunluğu (taslak gövdesi sınırı JSON bayttır). */
export function jsonByteLength(json: unknown): number {
  return new TextEncoder().encode(JSON.stringify(json)).length;
}
