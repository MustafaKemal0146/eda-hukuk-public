// Section düğümü (054 §2.2): üst düzeyin tek düğüm tipi; her section bir bloktur.
// Rol içerik kuralları şemada değil `validate`'tedir (§2.4): şema her role aynı içerik ifadesini verir.
import { SECTION_ROLES, type SectionRole } from '@eda/contracts/enums';
import { Node } from '@tiptap/core';
import { intMin, matchesOrNull, oneOf } from './attr-guards.ts';
import { BLOCK_ID_PATTERN } from './ids.ts';

export type RoleLabels = Partial<Readonly<Record<SectionRole, string>>>;

export type SectionOptions = {
  /** Erişilebilir ad için rol etiketleri (003 §4.3); paket `next-intl` içe aktarmaz (054 §14). */
  roleLabels: RoleLabels;
};

export const SECTION_CONTENT = '(heading | paragraph | orderedList | bulletList | table)+';

export const Section = Node.create<SectionOptions>({
  name: 'section',
  content: SECTION_CONTENT,
  isolating: true,
  defining: true,

  addOptions() {
    return { roleLabels: {} };
  },

  addAttributes() {
    return {
      // Zorunlu; istemcide UniqueID kayıttan önce doldurur, eksikse `blockId.missing` (054 §4.2).
      blockId: {
        default: null,
        validate: matchesOrNull('blockId', BLOCK_ID_PATTERN),
        parseHTML: (element) => element.getAttribute('data-block-id'),
        renderHTML: (attrs) => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
      },
      // Yalnız sunucu yazar (054 §3.2); dahili yapıştırmada 0'a sıfırlanır.
      rev: {
        default: 0,
        validate: intMin('rev', 0),
        parseHTML: () => 0,
        renderHTML: () => ({}),
      },
      role: {
        default: 'generic',
        validate: oneOf('role', SECTION_ROLES),
        parseHTML: (element) => element.getAttribute('data-role') ?? 'generic',
        renderHTML: (attrs) => ({ 'data-role': attrs.role, class: `eda-role-${attrs.role}` }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'section[data-block-id]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    const role = node.attrs.role as SectionRole;
    const label = this.options.roleLabels[role];
    return [
      'section',
      { ...HTMLAttributes, role: 'group', ...(label ? { 'aria-label': label } : {}) },
      0,
    ];
  },
});
