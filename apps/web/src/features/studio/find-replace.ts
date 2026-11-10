// Bul/değiştir modeli ve vurgulama eklentisi. Eşleşme Türkçe büyük/küçük harf ve aksan duyarsızdır
// (`@eda/legal` `tr_fold`; `toLowerCase` yok). Metin, bloklar arası ayırıcıyla düzleştirilir ve her
// karakterin belge konumu saklanır; normalizasyon ofset haritasıyla (`normalizeWithMap`) geri çözülür.
// Vurgular dekorasyondur: belgeye yazılmaz, geçmişe girmez. Doldurulacak alan sayacı aynı düzleştirme
// üzerinde `[[...]]` işaretlerini sayar.
import { normalizeWithMap, tr_fold } from '@eda/legal/text';
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/react';

export type Range = { from: number; to: number };

const SEPARATOR = '\n';
const PLACEHOLDER = /\[\[[^[\]\n]{1,200}\]\]/g;

/** Metin yaprakları tek dizgede; `pos[i]` i. karakterin belge konumu (ayırıcı için -1). */
export function flattenText(doc: PMNode): { text: string; pos: number[] } {
  let text = '';
  const pos: number[] = [];
  doc.descendants((node, nodePos) => {
    if (node.isTextblock) {
      if (text !== '') {
        text += SEPARATOR;
        pos.push(-1);
      }
      node.descendants((leaf, leafPos) => {
        if (leaf.isText && leaf.text) {
          for (let i = 0; i < leaf.text.length; i++) {
            text += leaf.text[i];
            pos.push(nodePos + 1 + leafPos + i);
          }
        }
        return false;
      });
      return false;
    }
    return true;
  });
  return { text, pos };
}

/** Sorguyu katlanmış metinde arar; blok sınırını aşan eşleşme alınmaz. */
export function findMatches(doc: PMNode, query: string): Range[] {
  if (tr_fold(query) === '') return [];
  const { text, pos } = flattenText(doc);
  const { norm, map } = normalizeWithMap(text);
  const folded = tr_fold(norm);
  // Katlama uzunluk korur; korumadıysa (beklenmez) iki taraf da yalnız normalize edilir.
  const foldable = folded.length === norm.length;
  const hay = foldable ? folded : norm;
  const q = foldable ? tr_fold(query) : normalizeWithMap(query).norm;
  if (q === '') return [];
  const out: Range[] = [];
  let i = hay.indexOf(q);
  while (i !== -1) {
    const start = map[i];
    const end = map[i + q.length - 1];
    if (
      start !== undefined &&
      end !== undefined &&
      !text.slice(start, end + 1).includes(SEPARATOR)
    ) {
      const from = pos[start];
      const to = pos[end];
      if (from !== undefined && to !== undefined && from >= 0 && to >= 0) {
        out.push({ from, to: to + 1 });
      }
    }
    i = hay.indexOf(q, i + q.length);
  }
  return out;
}

/** `[[Doldurulacak: ...]]` işaretlerinin belge aralıkları (ham metin; katlama yok). */
export function findPlaceholders(doc: PMNode): Range[] {
  const { text, pos } = flattenText(doc);
  const out: Range[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const from = pos[m.index];
    const to = pos[m.index + m[0].length - 1];
    if (from !== undefined && to !== undefined && from >= 0 && to >= 0) {
      out.push({ from, to: to + 1 });
    }
  }
  return out;
}

/** İmleçten sonraki ilk aralık; yoksa başa sarar. Boş listede `null`. */
export function nextRangeAfter(ranges: readonly Range[], cursor: number): Range | null {
  return ranges.find((r) => r.from > cursor) ?? ranges[0] ?? null;
}

/** İmleçten önceki son aralık; yoksa sona sarar. */
export function prevRangeBefore(ranges: readonly Range[], cursor: number): Range | null {
  const before = ranges.filter((r) => r.from < cursor);
  return before.at(-1) ?? ranges.at(-1) ?? null;
}

export function selectRange(editor: Editor, range: Range): void {
  editor.chain().focus().setTextSelection(range).scrollIntoView().run();
}

export function replaceRange(editor: Editor, range: Range, replacement: string): void {
  editor.view.dispatch(editor.state.tr.insertText(replacement, range.from, range.to));
}

/** Tek işlemde (tek geri alma adımı) tüm eşleşmeler; sondan başa yazılır ki konumlar kaymasın. */
export function replaceAll(editor: Editor, ranges: readonly Range[], replacement: string): number {
  if (ranges.length === 0) return 0;
  const tr = editor.state.tr;
  for (const r of [...ranges].sort((a, b) => b.from - a.from)) {
    tr.insertText(replacement, r.from, r.to);
  }
  editor.view.dispatch(tr);
  return ranges.length;
}

// --- vurgulama eklentisi ------------------------------------------------------------------

const KEY = new PluginKey<DecorationSet>('edaFindHighlight');
const MATCH_CLASS = 'bg-warning-soft';
const CURRENT_CLASS = 'bg-primary-soft outline outline-2 outline-primary';

export type FindHighlightState = { ranges: readonly Range[]; current: number };

function decorationsOf(doc: PMNode, state: FindHighlightState): DecorationSet {
  return DecorationSet.create(
    doc,
    state.ranges.map((r, i) =>
      Decoration.inline(r.from, r.to, { class: i === state.current ? CURRENT_CLASS : MATCH_CLASS }),
    ),
  );
}

export function setFindHighlight(editor: Editor, state: FindHighlightState | null): void {
  editor.view.dispatch(
    editor.state.tr
      .setMeta(KEY, state ?? { ranges: [], current: -1 })
      .setMeta('addToHistory', false),
  );
}

export const FindHighlight = Extension.create({
  name: 'edaFindHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: KEY,
        state: {
          init: () => DecorationSet.empty,
          apply(tr: Transaction, set) {
            const meta = tr.getMeta(KEY) as FindHighlightState | undefined;
            if (meta) return decorationsOf(tr.doc, meta);
            return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
          },
        },
        props: {
          decorations: (state) => KEY.getState(state) ?? DecorationSet.empty,
        },
      }),
    ];
  },
});
