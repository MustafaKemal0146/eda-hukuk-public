// İki sürüm arasında blok farkı (054 §8.5): hizalama `blockId` ile; yalnız `from`'da olan `removed`,
// yalnız `to`'da olan `added`; ortak bloklarda içerik (rev hariç) farklıysa `modified`, içerik aynı
// ama göreli sıra değiştiyse `moved`. Sıra farkı en uzun ortak altdizi (LCS) ile bulunur.
// Satır içi karakter farkını istemci `inline-diff` ile hesaplar; sunucu karakter farkı üretmez.
import type { BlockChangeKind } from '@eda/contracts/document-io';
import type { SectionRole } from '@eda/contracts/enums';
import { canonicalJson, stripRev } from '../hash/canonical.ts';

export type SectionJson = {
  type: 'section';
  attrs: { blockId: string; rev?: number; role: SectionRole } & Record<string, unknown>;
  content?: unknown[];
};
export type DocJson = { type: 'doc'; content: readonly SectionJson[] };

export type BlockDiffEntry = {
  blockId: string;
  role: SectionRole;
  change: BlockChangeKind;
  fromIndex?: number;
  toIndex?: number;
  before?: SectionJson;
  after?: SectionJson;
};

export type BlockDiffResult = { blocks: BlockDiffEntry[]; unchangedCount: number };

type Indexed = { section: SectionJson; index: number; key: string };

function index(doc: DocJson): Map<string, Indexed> {
  const map = new Map<string, Indexed>();
  doc.content.forEach((section, i) => {
    const id = section.attrs.blockId;
    if (!map.has(id)) map.set(id, { section, index: i, key: canonicalJson(stripRev(section)) });
  });
  return map;
}

/** İki kimlik dizisinin en uzun ortak altdizisindeki kimlikler. */
export function lcsIds(a: readonly string[], b: readonly string[]): Set<string> {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i] as number[];
    const next = dp[i + 1] as number[];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? (next[j + 1] ?? 0) + 1 : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const out = new Set<string>();
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.add(a[i] as string);
      i++;
      j++;
    } else if ((dp[i + 1]?.[j] ?? 0) >= (dp[i]?.[j + 1] ?? 0)) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/** Değişen bloklar `to` sırasıyla; `removed` bloklar `from`'daki önceki ortak bloğun ardından. */
export function blockDiff(from: DocJson, to: DocJson): BlockDiffResult {
  const a = index(from);
  const b = index(to);
  const fromOrder = [...a.keys()];
  const toOrder = [...b.keys()];
  const common = (ids: readonly string[], other: Map<string, Indexed>) =>
    ids.filter((id) => other.has(id));
  const stable = lcsIds(common(fromOrder, b), common(toOrder, a));

  // `removed` bloklar, `from` sırasında kendilerinden önce gelen son ortak bloğa bağlanır.
  const removedAfter = new Map<string | null, string[]>();
  let anchor: string | null = null;
  for (const id of fromOrder) {
    if (b.has(id)) {
      anchor = id;
      continue;
    }
    const list = removedAfter.get(anchor) ?? [];
    list.push(id);
    removedAfter.set(anchor, list);
  }

  const blocks: BlockDiffEntry[] = [];
  let unchangedCount = 0;
  const pushRemoved = (key: string | null): void => {
    for (const id of removedAfter.get(key) ?? []) {
      const old = a.get(id) as Indexed;
      blocks.push({
        blockId: id,
        role: old.section.attrs.role,
        change: 'removed',
        before: old.section,
      });
    }
  };
  pushRemoved(null);
  for (const id of toOrder) {
    const now = b.get(id) as Indexed;
    const old = a.get(id);
    if (old === undefined) {
      blocks.push({
        blockId: id,
        role: now.section.attrs.role,
        change: 'added',
        after: now.section,
      });
    } else if (old.key !== now.key) {
      blocks.push({
        blockId: id,
        role: now.section.attrs.role,
        change: 'modified',
        before: old.section,
        after: now.section,
      });
    } else if (!stable.has(id)) {
      blocks.push({
        blockId: id,
        role: now.section.attrs.role,
        change: 'moved',
        fromIndex: old.index,
        toIndex: now.index,
      });
    } else {
      unchangedCount++;
    }
    if (old !== undefined) pushRemoved(id);
  }
  return { blocks, unchangedCount };
}
