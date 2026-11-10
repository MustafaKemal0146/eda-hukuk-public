'use no memo';
'use client';
import type { SectionRole } from '@eda/contracts/enums';
// Editör kabuğu (054 §3, §10): TipTap `useEditor` + kapalı şema (`@eda/editor`). `rev` değerleri yalnız
// sunucudan gelir ve geri al yığınına girmez (`edaRevSync` meta). React Compiler bu dosyada kapalıdır:
// `useEditor` kendi abonelik modelini yönetir.
import { buildEditorExtensions } from '@eda/editor/schema';
import type { JSONContent } from '@tiptap/core';
import { type Editor, EditorContent, useEditor } from '@tiptap/react';
import { useEffect } from 'react';
import { FindHighlight } from './find-replace.ts';
import { Pagination } from './pagination.ts';

export const REV_SYNC_META = 'edaRevSync';

export type DocJson = JSONContent;

export function StudioEditor({
  initial,
  editable,
  label,
  onChange,
  onReady,
  onPages,
}: {
  initial: DocJson;
  editable: boolean;
  label: string;
  onChange: (editor: Editor) => void;
  onReady: (editor: Editor) => void;
  /** Sayfa sayısı (A4 sayfa görünümü) değişince. */
  onPages?: (pages: number) => void;
}) {
  const editor = useEditor({
    extensions: [
      ...buildEditorExtensions({ headless: false }),
      Pagination.configure({ onPages: onPages ?? null }),
      FindHighlight,
    ],
    content: initial,
    editable,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        lang: 'tr',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': label,
        spellcheck: 'true',
        class: 'outline-none',
      },
      handleDrop: () => true, // dosya/öğe bırakma reddedilir (054 §13)
    },
    onUpdate: ({ editor: e, transaction }) => {
      if (transaction.getMeta(REV_SYNC_META)) return;
      onChange(e);
    },
  });

  useEffect(() => {
    if (editor) onReady(editor);
  }, [editor, onReady]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);

  return <EditorContent editor={editor} />;
}

/** Sunucu `blockRevs` değerlerini bölümlere yazar; geçmişe girmez, `onUpdate` tetiklenmez. */
export function applyBlockRevs(editor: Editor, revs: Readonly<Record<string, number>>): void {
  const { state, view } = editor;
  let tr = state.tr;
  let changed = false;
  state.doc.forEach((node, offset) => {
    if (node.type.name !== 'section') return;
    const id = node.attrs.blockId as string | null;
    const next = id ? revs[id] : undefined;
    if (next !== undefined && node.attrs.rev !== next) {
      tr = tr.setNodeMarkup(offset, undefined, { ...node.attrs, rev: next });
      changed = true;
    }
  });
  if (changed) view.dispatch(tr.setMeta(REV_SYNC_META, true).setMeta('addToHistory', false));
}

export function currentSectionRole(editor: Editor): SectionRole | null {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'section') return n.attrs.role as SectionRole;
  }
  return null;
}

export function setCurrentSectionRole(editor: Editor, role: SectionRole): void {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'section') {
      const pos = $from.before(d);
      editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, role }));
      return;
    }
  }
}

export function addSectionAfterCurrent(editor: Editor): void {
  const { $from } = editor.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'section') {
      const after = $from.after(d);
      editor
        .chain()
        .insertContentAt(after, {
          type: 'section',
          attrs: { role: 'freeSection' },
          content: [{ type: 'paragraph' }],
        })
        .focus(after + 2)
        .run();
      return;
    }
  }
}
