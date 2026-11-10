// TipTap -> DocAST (054 §11.3). Saf ve deterministiktir: aynı girdi aynı baytları üretir.
// Atıf metni DB kaydından (`ctx.citations`) basılır; durum, işaret ve beyan notu BASILMAZ (025 §10.4).
// İmza bloğuna ibare eklenmez; çıktıda e-imza ibaresi varsa hata (`docast.forbidden_phrase`, Y-74).
import {
  DocAst,
  type DocAstBlock,
  type DocAstDocument,
  type DocAstPara,
  type DocAstRun,
  type DocAstSection,
} from '@eda/contracts/docast';
import type { DocumentKind, SectionRole } from '@eda/contracts/enums';
import { tr_fold } from '@eda/legal/text';
import type { Node as PMNode } from '@tiptap/pm/model';
import { isAllowedHref } from '../schema/link.ts';
import { type Issue, issue } from '../validate/issues.ts';
import { HEADING_ALIGN, PX_PER_MM, ROLE_DEFAULTS, TEXT_WIDTH_MM } from './role-defaults.ts';

/** Büro anteti (053-ekranlar/08 §5; alan adları P29'da kesinleşir). */
export type Letterhead = {
  enabled: boolean;
  firmName: string;
  addressLines: readonly string[];
  phone: string | null;
  email: string | null;
  lines: readonly string[];
};

export type ToDocAstContext = {
  kind: DocumentKind;
  title: string;
  /** `citationId` -> DB'den 081 biçimiyle render edilmiş künye metni. */
  citations: ReadonlyMap<string, { kunyeText: string }>;
  letterhead: Letterhead | null;
  includeLetterhead: boolean;
};

const HEADER_MAX_LINES = 8;

/** 084 D6 deseni; Türkçe büyük harf (İ) kaçmasın diye `tr_fold` edilmiş metinde aranır. */
const FORBIDDEN_PHRASE = /e-?imzalidir|elektronik olarak imzalanm/;

export class DocAstError extends Error {
  readonly issue: Issue;
  constructor(found: Issue) {
    super(found.message);
    this.name = 'DocAstError';
    this.issue = found;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function runsOf(node: PMNode, ctx: ToDocAstContext): DocAstRun[] {
  const runs: DocAstRun[] = [];
  node.forEach((child) => {
    if (child.type.name === 'hardBreak') {
      runs.push({ kind: 'break' });
      return;
    }
    let text: string;
    if (child.type.name === 'citation') {
      const id = child.attrs.citationId;
      const rendered = typeof id === 'string' ? ctx.citations.get(id) : undefined;
      text = rendered?.kunyeText ?? String(child.attrs.raw ?? '');
    } else if (child.isText) {
      text = child.text ?? '';
    } else {
      return;
    }
    const has = (name: string): boolean => child.marks.some((m) => m.type.name === name);
    const link = child.marks.find((m) => m.type.name === 'link');
    const href: unknown = link?.attrs.href;
    runs.push({
      kind: 'text',
      text,
      bold: has('bold'),
      italic: has('italic'),
      underline: has('underline'),
      strike: has('strike'),
      href: isAllowedHref(href) ? href : null,
    });
  });
  return runs;
}

function alignOf(node: PMNode, role: SectionRole): DocAstPara['align'] {
  const a = node.attrs.align;
  return a === 'left' || a === 'center' || a === 'right' || a === 'justify'
    ? a
    : ROLE_DEFAULTS[role].align;
}

function paraOf(node: PMNode, role: SectionRole, ctx: ToDocAstContext): DocAstPara {
  return { align: alignOf(node, role), runs: runsOf(node, ctx) };
}

function paragraphsOf(node: PMNode, role: SectionRole, ctx: ToDocAstContext): DocAstPara[] {
  const out: DocAstPara[] = [];
  node.forEach((p) => {
    if (p.type.name === 'paragraph') out.push(paraOf(p, role, ctx));
  });
  return out;
}

function tableOf(node: PMNode, role: SectionRole, ctx: ToDocAstContext): DocAstBlock {
  let cols = 0;
  node.forEach((row) => {
    cols = Math.max(cols, row.childCount);
  });
  const first = node.firstChild;
  const widthsPx: (number | null)[] = [];
  first?.forEach((cell) => {
    const w: unknown = Array.isArray(cell.attrs.colwidth) ? cell.attrs.colwidth[0] : null;
    widthsPx.push(typeof w === 'number' && w > 0 ? w : null);
  });
  const known = widthsPx.length === cols && widthsPx.every((w) => w !== null);
  const columnWidthsMm = known
    ? widthsPx.map((w) => round2((w as number) / PX_PER_MM))
    : Array.from({ length: cols }, () => round2(TEXT_WIDTH_MM / cols));
  const rows: { cells: { header: boolean; paragraphs: DocAstPara[] }[] }[] = [];
  node.forEach((row) => {
    const cells: { header: boolean; paragraphs: DocAstPara[] }[] = [];
    row.forEach((cell) => {
      cells.push({
        header: cell.type.name === 'tableHeader',
        paragraphs: paragraphsOf(cell, role, ctx),
      });
    });
    // D3: her satırda sütun sayısı kadar hücre (eksik hücre boş eklenir).
    while (cells.length < cols) cells.push({ header: false, paragraphs: [] });
    rows.push({ cells });
  });
  return { type: 'table', borders: 'grid', columnWidthsMm, rows };
}

function blocksOf(section: PMNode, role: SectionRole, ctx: ToDocAstContext): DocAstBlock[] {
  const d = ROLE_DEFAULTS[role];
  const blocks: DocAstBlock[] = [];
  section.forEach((child) => {
    switch (child.type.name) {
      case 'paragraph':
        blocks.push({
          type: 'paragraph',
          ...paraOf(child, role, ctx),
          indent: d.indent,
          hangingMm: d.hangingMm,
          tabStopsMm: [...d.tabStopsMm],
        });
        break;
      case 'heading': {
        const a = child.attrs.align;
        const align = a === 'center' || a === 'right' || a === 'justify' ? a : HEADING_ALIGN;
        blocks.push({
          type: 'heading',
          level: child.attrs.level === 2 ? 2 : 1,
          align,
          runs: runsOf(child, ctx).map((r) => (r.kind === 'text' ? { ...r, bold: true } : r)),
        });
        break;
      }
      case 'orderedList':
      case 'bulletList': {
        const items: { paragraphs: DocAstPara[] }[] = [];
        child.forEach((item) => {
          items.push({ paragraphs: paragraphsOf(item, role, ctx) });
        });
        const start = child.attrs.start;
        blocks.push({
          type: 'list',
          ordered: child.type.name === 'orderedList',
          start: typeof start === 'number' && Number.isInteger(start) ? start : 1,
          items,
        });
        break;
      }
      case 'table':
        blocks.push(tableOf(child, role, ctx));
        break;
      default:
        break;
    }
  });
  return blocks;
}

function headerOf(ctx: ToDocAstContext): DocAstDocument['header'] {
  const lh = ctx.letterhead;
  if (!ctx.includeLetterhead || lh === null || !lh.enabled) return null;
  const contact = [
    lh.phone !== null && lh.phone.trim() !== '' ? `Tel: ${lh.phone.trim()}` : null,
    lh.email !== null && lh.email.trim() !== '' ? `E-posta: ${lh.email.trim()}` : null,
  ]
    .filter((x): x is string => x !== null)
    .join(' · ');
  const lines = [lh.firmName, ...lh.addressLines, contact, ...lh.lines]
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .slice(0, HEADER_MAX_LINES);
  return { lines };
}

function paraTexts(block: DocAstBlock): string[] {
  const join = (p: DocAstPara): string =>
    p.runs.map((r) => (r.kind === 'text' ? r.text : '\n')).join('');
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return [join(block)];
    case 'list':
      return block.items.flatMap((i) => i.paragraphs.map(join));
    case 'table':
      return block.rows.flatMap((r) => r.cells.flatMap((c) => c.paragraphs.map(join)));
  }
}

function assertNoForbiddenPhrase(ast: DocAstDocument): void {
  const texts: [string, string][] = [['', ast.title]];
  for (const line of ast.header?.lines ?? []) texts.push(['', line]);
  ast.sections.forEach((s) => {
    for (const block of s.blocks) for (const t of paraTexts(block)) texts.push([s.id, t]);
  });
  for (const [blockId, text] of texts) {
    if (FORBIDDEN_PHRASE.test(tr_fold(text))) {
      throw new DocAstError(
        issue('docast.forbidden_phrase', 'error', blockId === '' ? null : blockId, ''),
      );
    }
  }
}

export function toDocAst(doc: PMNode, ctx: ToDocAstContext): DocAstDocument {
  const sections: DocAstSection[] = [];
  doc.forEach((section) => {
    const role = section.attrs.role as SectionRole;
    const d = ROLE_DEFAULTS[role];
    sections.push({
      id: String(section.attrs.blockId ?? ''),
      role,
      blocks: blocksOf(section, role, ctx),
      layout: d.layout,
      boxWidthMm: d.boxWidthMm,
      keepTogether: d.keepTogether,
    });
  });
  const ast: DocAstDocument = {
    schemaVersion: 1,
    kind: ctx.kind,
    title: ctx.title,
    page: { size: 'A4', marginsMm: { top: 20, bottom: 20, left: 25, right: 20 } },
    typography: {
      fontFamily: 'Liberation Serif',
      sizePt: 12,
      noteSizePt: 10,
      lineHeight: 1.5,
      firstLineIndentCm: 1.25,
      justify: true,
      hyphenate: false,
    },
    header: headerOf(ctx),
    sections,
  };
  assertNoForbiddenPhrase(ast);
  return DocAst.parse(ast);
}
