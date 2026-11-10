// Kapalı editör şemasının eklenti listesi (054 §2). Aynı liste sunucuda (`headless: true`, getSchema)
// ve tarayıcıda (P17c, `useEditor`) kullanılır. StarterKit v3 seçenek adları 3.31.4 tip tanımlarından
// doğrulanmıştır.
import { Extension, type Extensions, type NodeViewRenderer } from '@tiptap/core';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import { UniqueID } from '@tiptap/extension-unique-id';
import { StarterKit } from '@tiptap/starter-kit';
import { oneOf } from './attr-guards.ts';
import { Citation } from './citation.ts';
import { EdaDocument } from './document.ts';
import { newBlockId } from './ids.ts';
import { EdaLink } from './link.ts';
import { EdaListItem } from './list-item.ts';
import { type RoleLabels, Section } from './section.ts';

/** Paragraf/başlık hizası; `null` = rol varsayılanı (054 §2.2). `textAlign` eklentisi yüklenmez. */
export const PARAGRAPH_ALIGNS = ['left', 'center', 'right', 'justify'] as const;
export type ParagraphAlign = (typeof PARAGRAPH_ALIGNS)[number];

/** Başlık düzeyleri (054 §2.2). */
export const HEADING_LEVELS = [1, 2] as const;

const BlockAlign = Extension.create({
  name: 'edaBlockAlign',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          align: {
            default: null,
            validate: oneOf('align', [null, ...PARAGRAPH_ALIGNS]),
            parseHTML: (element) => element.getAttribute('data-align'),
            renderHTML: (attrs) => (attrs.align ? { 'data-align': attrs.align } : {}),
          },
        },
      },
    ];
  },
});

/** Hücre içeriği yalnız paragraf; birleştirme yok (colspan/rowspan = 1, `validate` denetler). */
const EdaTableCell = TableCell.extend({ content: 'paragraph+' });
const EdaTableHeader = TableHeader.extend({ content: 'paragraph+' });

/** Hücre birleştirme/bölme komutları kaldırılır (054 §2.2, MVP). */
const EdaTable = Table.extend({
  addCommands() {
    const parent = this.parent?.() ?? {};
    const {
      mergeCells: _merge,
      splitCell: _split,
      mergeOrSplit: _mergeOrSplit,
      ...rest
    } = parent as Record<string, unknown>;
    return rest as ReturnType<NonNullable<typeof this.parent>>;
  },
});

export type BuildEditorExtensionsOptions = {
  /** Sunucu/başsız kurulum: UniqueID gibi yalnız tarayıcıda çalışan eklentiler eklenmez. */
  headless: boolean;
  roleLabels?: RoleLabels;
  /** İstemcide atıf NodeView'ı (P17c). */
  citationNodeView?: NodeViewRenderer | null;
};

export function buildEditorExtensions(opts: BuildEditorExtensionsOptions): Extensions {
  const extensions: Extensions = [
    StarterKit.configure({
      document: false,
      trailingNode: false,
      blockquote: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
      // Özelleştirilmiş sürümleriyle yerine konanlar.
      listItem: false,
      link: false,
      heading: { levels: [...HEADING_LEVELS] },
    }),
    EdaDocument,
    Section.configure({ roleLabels: opts.roleLabels ?? {} }),
    Citation.configure({ nodeView: opts.citationNodeView ?? null }),
    EdaListItem,
    EdaLink,
    BlockAlign,
    EdaTable.configure({ resizable: false, allowTableNodeSelection: false }),
    TableRow,
    EdaTableHeader,
    EdaTableCell,
  ];
  if (!opts.headless) {
    // Yinelenen kimlik davranışı eklentinindir; sunucu UniqueID çalıştırmaz (054 §3.1).
    extensions.push(
      UniqueID.configure({
        types: ['section'],
        attributeName: 'blockId',
        generateID: () => newBlockId(),
      }),
    );
  }
  return extensions;
}
