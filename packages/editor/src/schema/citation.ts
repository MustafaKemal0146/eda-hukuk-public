// Atıf düğümü (054 §2.5, 025 §2.3): satır içi atom. `status` yalnız gösterim önbelleğidir; yetkili
// durum `message_citations`'tadır. Metin olarak serileştirmede `raw` kullanılır (durum metne girmez).
import { KUNYE_STATUSES } from '@eda/contracts/enums';
import { Node, type NodeViewRenderer } from '@tiptap/core';
import { oneOf, stringOrNull } from './attr-guards.ts';

/** `raw` en çok 300 karakter (054 §2.5). */
export const CITATION_RAW_MAX = 300;

export type CitationOptions = {
  /** İstemcide React NodeView (P17c); başsız kurulumda `null`. */
  nodeView: NodeViewRenderer | null;
};

export type CitationAttrs = {
  citationId: string | null;
  raw: string;
  sourceRef: string | null;
  status: (typeof KUNYE_STATUSES)[number];
  attestKey: string | null;
};

export const Citation = Node.create<CitationOptions>({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { nodeView: null };
  },

  addAttributes() {
    return {
      citationId: {
        default: null,
        validate: stringOrNull('citationId'),
        parseHTML: (element) => element.getAttribute('data-citation-id'),
        renderHTML: (attrs) => (attrs.citationId ? { 'data-citation-id': attrs.citationId } : {}),
      },
      raw: {
        default: '',
        validate: (value: unknown) => {
          if (typeof value !== 'string' || value.length > CITATION_RAW_MAX) {
            throw new RangeError('Geçersiz raw değeri.');
          }
        },
        parseHTML: (element) => element.textContent ?? '',
        renderHTML: () => ({}),
      },
      sourceRef: { default: null, validate: stringOrNull('sourceRef'), renderHTML: () => ({}) },
      status: {
        default: 'pending',
        validate: oneOf('status', KUNYE_STATUSES),
        renderHTML: () => ({}),
      },
      attestKey: { default: null, validate: stringOrNull('attestKey'), renderHTML: () => ({}) },
    };
  },

  extendNodeSchema(extension) {
    if (extension.name !== 'citation') return {};
    return { leafText: (node: { attrs: Record<string, unknown> }) => String(node.attrs.raw ?? '') };
  },

  renderText({ node }) {
    return String(node.attrs.raw ?? '');
  },

  parseHTML() {
    return [{ tag: 'span[data-citation-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', { ...HTMLAttributes, class: 'eda-cite' }, String(node.attrs.raw ?? '')];
  },

  addNodeView() {
    return this.options.nodeView;
  },
});
