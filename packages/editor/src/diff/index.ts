// Sürüm farkı (054 §6.6, §8.5).
export {
  type BlockDiffEntry,
  type BlockDiffResult,
  blockDiff,
  type DocJson,
  lcsIds,
  type SectionJson,
} from './block-diff.ts';
export {
  type InlineDiffOptions,
  type InlineDiffPart,
  type InlineDiffResult,
  inlineDiff,
} from './inline-diff.ts';
