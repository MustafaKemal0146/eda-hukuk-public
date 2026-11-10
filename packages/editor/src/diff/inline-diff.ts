// Satır içi karakter farkı (054 §6.6, §8.5): diff-match-patch (ESM çatalı `diff-match-patch-es`,
// ) karakter düzeyi + `diffCleanupSemantic`; yalnız saf metin. Toplam metin
// `editor.inlineDiffMaxChars` üstündeyse veya hesap `editor.diffTimeoutMs`'i aşarsa blok düzeyine düşülür.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { DIFF_DELETE, DIFF_INSERT, diffCleanupSemantic, diffMain } from 'diff-match-patch-es';

export type InlineDiffPart = { op: 'equal' | 'insert' | 'delete'; text: string };

export type InlineDiffResult =
  | { mode: 'inline'; parts: InlineDiffPart[] }
  | { mode: 'block'; reason: 'too_large' | 'timeout' };

export type InlineDiffOptions = {
  timeoutMs?: number;
  maxChars?: number;
  /** Yalnız test için saat (ms). */
  now?: () => number;
};

export function inlineDiff(
  before: string,
  after: string,
  opts: InlineDiffOptions = {},
): InlineDiffResult {
  const timeoutMs = opts.timeoutMs ?? CONFIG_DEFAULTS['editor.diffTimeoutMs'];
  const maxChars = opts.maxChars ?? CONFIG_DEFAULTS['editor.inlineDiffMaxChars'];
  const now = opts.now ?? Date.now;
  if (before.length + after.length > maxChars) return { mode: 'block', reason: 'too_large' };
  const started = now();
  // Karakter düzeyi: satır kipi kapalı (opt_checklines = false).
  const diffs = diffMain(before, after, { diffTimeout: timeoutMs / 1000 }, false);
  if (now() - started >= timeoutMs) return { mode: 'block', reason: 'timeout' };
  diffCleanupSemantic(diffs);
  return {
    mode: 'inline',
    parts: diffs.map(([op, text]) => ({
      op: op === DIFF_INSERT ? 'insert' : op === DIFF_DELETE ? 'delete' : 'equal',
      text,
    })),
  };
}
