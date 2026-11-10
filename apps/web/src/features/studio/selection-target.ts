// Seçili kısım hedefi (saf, DOM'suz): seçim, bölüm kimliği + seçili metin + bölüm içindeki sıra ile
// tanımlanır; karakter ofseti saklanmaz (belge bu arada değişebilir). Uygulamada metin bölümde yeniden
// aranır; bulunamazsa hata (belge sessizce bozulmaz). Yanıt, seçim tam blok(lar)ı kapsıyorsa blok olarak,
// aksi hâlde satır içi (hardBreak ile) yazılır; belgenin kalanına dokunulmaz.
import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { blocksToContent, markdownToBlocks } from './doc-convert.ts';
import { flattenText, type Range } from './find-replace.ts';

export type SelectionTarget = {
  blockId: string;
  text: string;
  /** Aynı metnin bölüm içindeki kaçıncı geçişi (0 tabanlı). */
  occurrence: number;
  /** Seçim bir veya daha çok bloğu baştan sona kapsıyor. */
  whole: boolean;
};

export class SelectionNotFoundError extends Error {
  constructor() {
    super('Seçili kısım belgede bulunamadı.');
    this.name = 'SelectionNotFoundError';
  }
}

type SectionHit = { node: PMNode; pos: number };

function sectionAt(doc: PMNode, pos: number): SectionHit | null {
  const $pos = doc.resolve(pos);
  if ($pos.depth < 1) return null;
  return { node: $pos.node(1), pos: $pos.before(1) };
}

function sectionById(doc: PMNode, blockId: string): SectionHit | null {
  let hit: SectionHit | null = null;
  doc.forEach((node, pos) => {
    if (hit === null && node.type.name === 'section' && node.attrs.blockId === blockId) {
      hit = { node, pos };
    }
  });
  return hit;
}

/** Bölüm içindeki tüm tam geçişlerin mutlak aralıkları (bölüm düzleştirmesi üzerinde). */
function occurrencesIn(section: SectionHit, text: string): Range[] {
  if (text === '') return [];
  const { text: flat, pos } = flattenText(section.node);
  const base = section.pos + 1;
  const out: Range[] = [];
  let i = flat.indexOf(text);
  while (i !== -1) {
    const from = pos[i];
    const to = pos[i + text.length - 1];
    if (from !== undefined && to !== undefined && from >= 0 && to >= 0) {
      out.push({ from: base + from, to: base + to + 1 });
    }
    i = flat.indexOf(text, i + text.length);
  }
  return out;
}

/** Editördeki seçimden hedef; bölüm dışına taşan veya boş seçimde `null`. */
export function selectionTargetOf(doc: PMNode, from: number, to: number): SelectionTarget | null {
  if (to <= from) return null;
  const a = sectionAt(doc, from);
  const b = sectionAt(doc, to);
  if (!a || !b || a.pos !== b.pos) return null;
  const blockId = a.node.attrs.blockId;
  if (typeof blockId !== 'string') return null;
  const text = doc.textBetween(from, to, '\n');
  if (text.trim() === '') return null;
  const occurrence = occurrencesIn(a, text).findIndex((r) => r.from === from && r.to === to);
  if (occurrence === -1) return null;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const whole = $from.parentOffset === 0 && $to.parentOffset === $to.parent.content.size;
  return { blockId, text, occurrence, whole };
}

/** Hedefi belgede yeniden bulur; bölüm silinmiş veya metin değişmişse `null`. */
export function locateSelection(doc: PMNode, target: SelectionTarget): Range | null {
  const section = sectionById(doc, target.blockId);
  if (!section) return null;
  return occurrencesIn(section, target.text)[target.occurrence] ?? null;
}

function inlineNodes(schema: Schema, markdown: string): PMNode[] {
  const nodes: PMNode[] = [];
  const hardBreak = schema.nodes.hardBreak;
  markdownToBlocks(markdown).forEach((b, i) => {
    if (i > 0 && hardBreak) nodes.push(hardBreak.create());
    for (const run of b.runs) {
      if (run.text === '') continue;
      const marks = run.marks.flatMap((m) => {
        const type = schema.marks[m];
        return type ? [type.create()] : [];
      });
      nodes.push(schema.text(run.text, marks));
    }
  });
  return nodes;
}

/** Yanıtı yalnız hedef aralığın yerine yazar; yeni belge düğümünü döndürür. */
export function applySelectionEdit(doc: PMNode, target: SelectionTarget, markdown: string): PMNode {
  const range = locateSelection(doc, target);
  if (!range) throw new SelectionNotFoundError();
  const schema = doc.type.schema;
  const tr = EditorState.create({ doc }).tr;
  const $from = doc.resolve(range.from);
  const $to = doc.resolve(range.to);
  const blockLevel =
    target.whole &&
    $from.depth === 2 &&
    $to.depth === 2 &&
    $from.parentOffset === 0 &&
    $to.parentOffset === $to.parent.content.size;
  if (blockLevel) {
    const blocks = blocksToContent(markdownToBlocks(markdown)).map((json) =>
      schema.nodeFromJSON(json),
    );
    const paragraph = schema.nodes.paragraph;
    const nodes = blocks.length > 0 ? blocks : paragraph ? [paragraph.create()] : [];
    tr.replaceWith($from.before(2), $to.after(2), nodes);
  } else {
    const nodes = inlineNodes(schema, markdown);
    if (nodes.length === 0) tr.delete(range.from, range.to);
    else tr.replaceWith(range.from, range.to, nodes);
  }
  return tr.doc;
}
