// Dilekçe sayfa düzeni (saf): kök düzen özniteliklerinin (`@eda/editor` DocLayout) CSS, DOCX ve PDF
// karşılıkları ve sözcük sayımı. Yazı tipleri sistem/self-host adlarıyla verilir; CDN yok (051 §16).
import { DEFAULT_DOC_LAYOUT, type DocFont, type DocLayout, docLayoutOf } from '@eda/editor/schema';
import type { Editor } from '@tiptap/react';

/** CSS `font-family` dizgeleri: yerel yüz varsa o, yoksa metrik uyumlu sistem fontu. */
export const FONT_CSS: Readonly<Record<DocFont, string>> = {
  'times-new-roman':
    '"Times New Roman", var(--font-liberation-serif, "Liberation Serif"), Times, serif',
  'liberation-serif': 'var(--font-liberation-serif, "Liberation Serif"), "Times New Roman", serif',
  'source-serif': 'var(--font-serif, "Source Serif 4"), Georgia, "Times New Roman", serif',
  arial: 'Arial, "Liberation Sans", Helvetica, sans-serif',
};

/** DOCX `w:rFonts` ve PDF yazdırma için yüz adı (ikinci ad metrik uyumlu yedek). */
export const FONT_NAMES: Readonly<Record<DocFont, readonly [string, string]>> = {
  'times-new-roman': ['Times New Roman', 'Liberation Serif'],
  'liberation-serif': ['Liberation Serif', 'Times New Roman'],
  'source-serif': ['Source Serif 4', 'Georgia'],
  arial: ['Arial', 'Liberation Sans'],
};

export type LayoutCssVars = {
  '--eda-paper-font': string;
  '--eda-paper-font-size': string;
  '--eda-paper-line-height': string;
};

export function layoutCssVars(layout: DocLayout): LayoutCssVars {
  return {
    '--eda-paper-font': FONT_CSS[layout.fontFamily],
    '--eda-paper-font-size': `${layout.fontSizePt}pt`,
    '--eda-paper-line-height': String(layout.lineHeight),
  };
}

/** PDF yazdırma gövdesi için ek CSS (document-export.ts `STYLE` sonrasına eklenir, onu ezer). */
export function pdfCssOf(layout: DocLayout): string {
  const [primary, fallback] = FONT_NAMES[layout.fontFamily];
  return `body { font-family: "${primary}", "${fallback}", serif; font-size: ${layout.fontSizePt}pt; line-height: ${layout.lineHeight}; }
h3, h4, h5 { font-size: ${layout.fontSizePt}pt; }`;
}

/** Sözcük sayısı: boşlukla ayrılmış, en az bir harf veya rakam içeren parçalar. */
export function wordCount(text: string): number {
  let n = 0;
  for (const part of text.split(/\s+/u)) {
    if (/[\p{L}\p{N}]/u.test(part)) n += 1;
  }
  return n;
}

export function editorLayout(editor: Editor): DocLayout {
  return docLayoutOf(editor.state.doc.attrs);
}

/** Düzen değişikliği belgeye yazılır (kök öznitelik adımı; geri alınabilir, otomatik kayda girer). */
export function setDocLayout(editor: Editor, patch: Partial<DocLayout>): void {
  const next = { ...editorLayout(editor), ...patch };
  const tr = editor.state.tr;
  for (const key of Object.keys(DEFAULT_DOC_LAYOUT) as (keyof DocLayout)[]) {
    if (editor.state.doc.attrs[key] !== next[key]) tr.setDocAttribute(key, next[key]);
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}
