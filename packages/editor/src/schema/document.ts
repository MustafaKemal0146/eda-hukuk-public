// Kök düğüm (054 §2.1): `doc` -> `section+`. StarterKit'in `document` eklentisi kapatılır ve yerine
// bu düğüm konur; kök düzeyde `paragraph` veya başka düğüm bulunamaz.
// Sayfa düzeni (yazı tipi, punto, satır aralığı) belge başına kök özniteliklerinde saklanır: taslakla
// birlikte kaydedilir, sürüme girer, `parseDocJson` doğrular. DocAST/doc-engine tipografisi (084) bu
// özniteliklerden bağımsızdır; tarayıcı DOCX/PDF yazıcıları bunları uygular.
import { Node } from '@tiptap/core';
import { oneOf } from './attr-guards.ts';

/** Yazı tipi anahtarları; CSS/DOCX adları uygulamada eşlenir (sistem fontu adı, CDN yok). */
export const DOC_FONTS = ['times-new-roman', 'liberation-serif', 'source-serif', 'arial'] as const;
export type DocFont = (typeof DOC_FONTS)[number];
export const DOC_FONT_SIZES = [11, 12, 13] as const;
export type DocFontSize = (typeof DOC_FONT_SIZES)[number];
export const DOC_LINE_HEIGHTS = [1, 1.15, 1.5] as const;
export type DocLineHeight = (typeof DOC_LINE_HEIGHTS)[number];

export type DocLayout = { fontFamily: DocFont; fontSizePt: DocFontSize; lineHeight: DocLineHeight };

export const DEFAULT_DOC_LAYOUT: DocLayout = {
  fontFamily: 'times-new-roman',
  fontSizePt: 12,
  lineHeight: 1.5,
};

const pick = <T extends string | number>(list: readonly T[], v: unknown, fallback: T): T =>
  (list as readonly unknown[]).includes(v) ? (v as T) : fallback;

/** Kök öznitelik nesnesinden geçerli düzen; eksik/geçersiz değerde varsayılan. */
export function docLayoutOf(
  attrs: Readonly<Record<string, unknown>> | null | undefined,
): DocLayout {
  return {
    fontFamily: pick(DOC_FONTS, attrs?.fontFamily, DEFAULT_DOC_LAYOUT.fontFamily),
    fontSizePt: pick(DOC_FONT_SIZES, attrs?.fontSizePt, DEFAULT_DOC_LAYOUT.fontSizePt),
    lineHeight: pick(DOC_LINE_HEIGHTS, attrs?.lineHeight, DEFAULT_DOC_LAYOUT.lineHeight),
  };
}

export const EdaDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'section+',
  addAttributes() {
    return {
      fontFamily: {
        default: DEFAULT_DOC_LAYOUT.fontFamily,
        validate: oneOf('fontFamily', DOC_FONTS),
      },
      fontSizePt: {
        default: DEFAULT_DOC_LAYOUT.fontSizePt,
        validate: oneOf('fontSizePt', DOC_FONT_SIZES),
      },
      lineHeight: {
        default: DEFAULT_DOC_LAYOUT.lineHeight,
        validate: oneOf('lineHeight', DOC_LINE_HEIGHTS),
      },
    };
  },
});
