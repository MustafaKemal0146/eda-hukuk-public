// @tk TK-16
// Blok farkı (054 §8.5) ve satır içi fark (054 §6.6).
import { describe, expect, it } from 'vitest';
import { blockDiff, type DocJson, lcsIds } from '../../src/diff/block-diff.ts';
import { inlineDiff } from '../../src/diff/inline-diff.ts';
import { doc, para, section, text } from '../helpers.ts';

const s = (id: string, body: string, role = 'generic', rev = 1) => ({
  ...section(id, role, para(text(body))),
  attrs: { blockId: id, rev, role },
});
const d = (...sections: ReturnType<typeof s>[]) => doc(...sections) as unknown as DocJson;

describe('KK-P17a-8 KK-054-17: block-diff', () => {
  it('KK-P17a-8: added, removed, modified, moved ve değişmeyen sayısı', () => {
    const from = d(s('b-00000A', 'a'), s('b-00000B', 'b'), s('b-00000C', 'c'), s('b-00000D', 'd'));
    const to = d(
      s('b-00000A', 'a', 'generic', 5),
      s('b-00000C', 'c'),
      s('b-00000B', 'b'),
      s('b-00000E', 'yeni'),
      s('b-00000D', 'd değişti'),
    );
    const r = blockDiff(from, to);
    expect(r.blocks.map((b) => [b.blockId, b.change])).toEqual([
      ['b-00000B', 'moved'],
      ['b-00000E', 'added'],
      ['b-00000D', 'modified'],
    ]);
    // LCS eşitliğinde C kalır, B taşınmış sayılır; A (yalnız rev değişti) ve C değişmemiş.
    expect(r.unchangedCount).toBe(2);
    const moved = r.blocks[0];
    expect([moved?.fromIndex, moved?.toIndex]).toEqual([1, 2]);
    const modified = r.blocks[2];
    expect(modified?.before).toBeDefined();
    expect(modified?.after).toBeDefined();
  });

  it('KK-P17a-8: removed bloklar from sırasındaki önceki ortak bloğun ardından gelir', () => {
    const from = d(s('b-00000X', 'x'), s('b-00000A', 'a'), s('b-00000Y', 'y'), s('b-00000B', 'b'));
    const to = d(s('b-00000A', 'a'), s('b-00000B', 'b'));
    expect(blockDiff(from, to).blocks.map((b) => [b.blockId, b.change])).toEqual([
      ['b-00000X', 'removed'],
      ['b-00000Y', 'removed'],
    ]);
    const r = blockDiff(from, to);
    expect(r.blocks[0]?.before).toBeDefined();
    expect(r.unchangedCount).toBe(2);
  });

  it('KK-P17a-8: rol değişikliği modified sayılır; aynı belge farksız', () => {
    const from = d(s('b-00000A', 'a', 'generic'));
    const to = d(s('b-00000A', 'a', 'freeSection'));
    expect(blockDiff(from, to).blocks.map((b) => b.change)).toEqual(['modified']);
    expect(blockDiff(from, from)).toEqual({ blocks: [], unchangedCount: 1 });
  });

  it('KK-P17a-8: LCS en uzun ortak altdizi', () => {
    expect([...lcsIds(['a', 'b', 'c', 'd'], ['b', 'd', 'a', 'c'])].sort()).toHaveLength(2);
    expect([...lcsIds(['a', 'b', 'c'], ['a', 'b', 'c'])]).toEqual(['a', 'b', 'c']);
    expect([...lcsIds(['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'b', 'd', 'e'])]).toHaveLength(4);
  });
});

describe('KK-P17a-8: inline-diff', () => {
  it('karakter düzeyi fark ve anlamsal temizlik', () => {
    const r = inlineDiff('Davalı borcunu ödemedi.', 'Davalı borcunu hâlâ ödemedi.');
    expect(r.mode).toBe('inline');
    if (r.mode !== 'inline') return;
    expect(r.parts.filter((p) => p.op === 'insert').map((p) => p.text.trim())).toEqual(['hâlâ']);
    expect(r.parts.filter((p) => p.op === 'delete')).toEqual([]);
    expect(r.parts.map((p) => (p.op === 'delete' ? '' : p.text)).join('')).toBe(
      'Davalı borcunu hâlâ ödemedi.',
    );
  });

  it('KK-P17a-8: editor.inlineDiffMaxChars aşımında blok düzeyine düşer', () => {
    expect(inlineDiff('a'.repeat(10), 'b'.repeat(10), { maxChars: 15 })).toEqual({
      mode: 'block',
      reason: 'too_large',
    });
  });

  it('KK-P17a-8: zaman aşımında blok düzeyine düşer', () => {
    let t = 0;
    const now = () => {
      const v = t;
      t += 500;
      return v;
    };
    expect(inlineDiff('eski metin', 'yeni metin', { timeoutMs: 200, now })).toEqual({
      mode: 'block',
      reason: 'timeout',
    });
  });
});
