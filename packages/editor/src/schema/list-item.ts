// Liste öğesi (054 §2.2): içerik yalnız `paragraph+`; liste içinde liste YOK. StarterKit `listItem`
// kapatılır (içerik ifadesi `extendNodeSchema` ile ezilemiyor). Tab girinti yapmaz.
import { Node } from '@tiptap/core';

export const EdaListItem = Node.create({
  name: 'listItem',
  content: 'paragraph+',
  defining: true,

  parseHTML() {
    return [{ tag: 'li' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['li', HTMLAttributes, 0];
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => this.editor.commands.splitListItem(this.name),
      'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
    };
  },
});
