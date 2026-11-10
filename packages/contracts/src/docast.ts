// DocAST: TipTap JSON ile DOCX/UDF yazıcıları (doc-engine) arasındaki durumsuz ara biçim (054 §11.2,
// 084 §3.1). Tek kaynak bu dosyadır; `gen:schemas` -> JSON Schema -> Pydantic v2 (013 §17.2).
// Özyinelemesizdir (`z.lazy` yok; derinlik DocAst -> Section -> Block -> Run sabit). Sayfa ve tipografi
// değerleri `z.literal` ile sabittir: 084 değişirse `schemaVersion` artar.
// Dosya yalnız `DocAst` Zod şemasını dışa aktarır (gen-schemas kuralı: dosya başına bir şema).
import { z } from 'zod';
import { DOCUMENT_KINDS, SECTION_ROLES } from './enums.ts';

const Align = z.enum(['left', 'center', 'right', 'justify']);

const Run = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    text: z.string(),
    bold: z.boolean(),
    italic: z.boolean(),
    underline: z.boolean(),
    strike: z.boolean(),
    /** Yalnız `https:` / `mailto:`. */
    href: z.string().nullable(),
  }),
  /** `hardBreak`. */
  z.strictObject({ kind: z.literal('break') }),
]);

const Para = z.strictObject({ align: Align, runs: z.array(Run) });

const Paragraph = Para.extend({
  type: z.literal('paragraph'),
  indent: z.enum(['none', 'first_line', 'hanging']),
  hangingMm: z.number().nullable(),
  tabStopsMm: z.array(z.number()),
});

const Heading = Para.extend({
  type: z.literal('heading'),
  level: z.union([z.literal(1), z.literal(2)]),
});

const List = z.strictObject({
  type: z.literal('list'),
  ordered: z.boolean(),
  start: z.number().int(),
  items: z.array(z.strictObject({ paragraphs: z.array(Para) })),
});

const Table = z.strictObject({
  type: z.literal('table'),
  borders: z.enum(['none', 'grid']),
  columnWidthsMm: z.array(z.number()),
  rows: z.array(
    z.strictObject({
      cells: z.array(z.strictObject({ header: z.boolean(), paragraphs: z.array(Para) })),
    }),
  ),
});

const Block = z.discriminatedUnion('type', [Paragraph, Heading, List, Table]);

const SectionAst = z.strictObject({
  /** `blockId`. */
  id: z.string(),
  role: z.enum(SECTION_ROLES),
  blocks: z.array(Block),
  layout: z.enum(['flow', 'right_box']),
  boxWidthMm: z.number().nullable(),
  keepTogether: z.boolean(),
});

export const DocAst = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.enum(DOCUMENT_KINDS),
  title: z.string(),
  page: z.strictObject({
    size: z.literal('A4'),
    marginsMm: z.strictObject({
      top: z.literal(20),
      bottom: z.literal(20),
      left: z.literal(25),
      right: z.literal(20),
    }),
  }),
  typography: z.strictObject({
    fontFamily: z.literal('Liberation Serif'),
    sizePt: z.literal(12),
    noteSizePt: z.literal(10),
    lineHeight: z.literal(1.5),
    firstLineIndentCm: z.literal(1.25),
    justify: z.literal(true),
    hyphenate: z.literal(false),
  }),
  /** Büro anteti (üst bilgi; 053-ekranlar/08 §5); filigran yok. */
  header: z.strictObject({ lines: z.array(z.string()).max(8) }).nullable(),
  sections: z.array(SectionAst),
});

export type DocAstDocument = z.infer<typeof DocAst>;
export type DocAstSection = z.infer<typeof SectionAst>;
export type DocAstBlock = z.infer<typeof Block>;
export type DocAstParagraph = z.infer<typeof Paragraph>;
export type DocAstHeading = z.infer<typeof Heading>;
export type DocAstList = z.infer<typeof List>;
export type DocAstTable = z.infer<typeof Table>;
export type DocAstPara = z.infer<typeof Para>;
export type DocAstRun = z.infer<typeof Run>;
export type DocAstAlign = z.infer<typeof Align>;
