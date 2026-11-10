// DocAST -> TipTap JSON + ImportReport (054 §11.4). doc-engine içe aktarmada düz akış (tek
// `freeSection`) üretir; bölümleme burada yapılır. Rol tanıma yalnız `kind = petition` içindir ve
// `import-roles.ts` tablosuyla TAM eşleşmedir; eşleşmeyen her şey `freeSection`'a düşer.
// Gizli içerik doc-engine'de ayrılır (084 §8.4); burada sayısı rapora taşınır ve metin ayrıca
// `sanitizeText`'ten geçer. Desteklenmeyen yapı metni korunarak paragrafa iner.
import type { DocAstBlock, DocAstDocument, DocAstPara, DocAstRun } from '@eda/contracts/docast';
import type { ImportReportDto } from '@eda/contracts/document-io';
import type { DocumentKind, SectionRole } from '@eda/contracts/enums';
import { extractAll } from '@eda/legal/kunye';
import type { JSONContent } from '@tiptap/core';
import { newBlockId } from '../schema/ids.ts';
import { isAllowedHref } from '../schema/link.ts';
import { parseSectionJson } from '../schema/parse-doc.ts';
import { sanitizeText } from '../schema/sanitize-text.ts';
import { hasErrors, TABLE_MAX_COLS, TABLE_MAX_ROWS, validateSection } from '../validate/index.ts';
import {
  COURT_HEADER_KEYWORDS,
  COURT_HEADER_MAX_PARAGRAPHS,
  foldLabel,
  HEADING_ROLES,
  labelOf,
  PARTY_LABEL_WORDS,
  SIGNATURE_KEYWORDS,
  SIGNATURE_LINE_MAX_CHARS,
  SIGNATURE_MAX_PARAGRAPHS,
  SUBJECT_LABELS,
  words,
} from './import-roles.ts';

export type EngineImportReport = {
  hiddenContentSkipped: number;
  droppedFeatures: readonly { feature: string; count: number }[];
  warnings: readonly string[];
};

export type FromDocAstContext = {
  kind: DocumentKind;
  /** Yalnız test için deterministik kimlik üreticisi. */
  newBlockId?: (existing: ReadonlySet<string>) => string;
  /** doc-engine `ImportEngineReport` (084 §7). */
  engineReport?: EngineImportReport | null;
  /** Verilirse künye adayları `extractAll` ile sayılır (Europe/Istanbul günü, ISO). */
  today?: string | null;
};

export type FromDocAstResult = { doc: JSONContent; report: ImportReportDto };

type Group = { role: SectionRole; blocks: DocAstBlock[]; via: 'label' | 'heading' | 'free' };

const WARN_DOWNGRADED = 'Rol kurallarına uymayan bir bölüm serbest bölüme çevrildi.';

function paraText(p: DocAstPara): string {
  return p.runs.map((r) => (r.kind === 'text' ? r.text : '\n')).join('');
}

function blockText(b: DocAstBlock): string {
  if (b.type === 'paragraph' || b.type === 'heading') return paraText(b);
  if (b.type === 'list') return b.items.flatMap((i) => i.paragraphs.map(paraText)).join('\n');
  return b.rows.flatMap((r) => r.cells.flatMap((c) => c.paragraphs.map(paraText))).join('\n');
}

function headingRole(b: DocAstBlock): SectionRole | null {
  if (b.type !== 'paragraph' && b.type !== 'heading') return null;
  return HEADING_ROLES[foldLabel(paraText(b))] ?? null;
}

function isPartyRow(b: DocAstBlock): boolean {
  if (b.type !== 'paragraph') return false;
  const label = labelOf(paraText(b));
  const first = label === null ? undefined : words(foldLabel(label))[0];
  return first !== undefined && (PARTY_LABEL_WORDS as readonly string[]).includes(first);
}

function isSubjectRow(b: DocAstBlock): boolean {
  if (b.type !== 'paragraph') return false;
  const label = labelOf(paraText(b));
  return label !== null && (SUBJECT_LABELS as readonly string[]).includes(foldLabel(label));
}

function courtHeaderEnd(blocks: readonly DocAstBlock[]): number {
  let end = 0;
  while (
    end < blocks.length &&
    end < COURT_HEADER_MAX_PARAGRAPHS &&
    blocks[end]?.type === 'paragraph' &&
    (blocks[end] as DocAstPara).align === 'center'
  ) {
    end++;
  }
  const folded = words(foldLabel(blocks.slice(0, end).map(blockText).join(' ')));
  return COURT_HEADER_KEYWORDS.some((k) => folded.includes(k)) ? end : 0;
}

function signatureStart(blocks: readonly DocAstBlock[], from: number): number {
  let start = blocks.length;
  while (
    start > from &&
    blocks.length - start < SIGNATURE_MAX_PARAGRAPHS &&
    blocks[start - 1]?.type === 'paragraph'
  ) {
    const p = blocks[start - 1] as DocAstPara;
    if (
      (p.align !== 'center' && p.align !== 'right') ||
      paraText(p).length > SIGNATURE_LINE_MAX_CHARS
    ) {
      break;
    }
    start--;
  }
  // İmza bloğu sıfat satırıyla başlar ("<Sıfat> Vekili"; 080 §5.2): öncesindeki kısa satırlar
  // (ör. sağa yaslı tarih satırı) önceki bölümde kalır.
  const capacity = SIGNATURE_KEYWORDS[0];
  while (
    start < blocks.length &&
    !words(foldLabel(blockText(blocks[start] as DocAstBlock))).includes(capacity)
  ) {
    start++;
  }
  const folded = words(foldLabel(blocks.slice(start).map(blockText).join(' ')));
  return start < blocks.length && SIGNATURE_KEYWORDS.every((k) => folded.includes(k))
    ? start
    : blocks.length;
}

function segmentPetition(blocks: readonly DocAstBlock[]): Group[] {
  const groups: Group[] = [];
  const headerEnd = courtHeaderEnd(blocks);
  if (headerEnd > 0)
    groups.push({ role: 'courtHeader', blocks: blocks.slice(0, headerEnd), via: 'label' });
  const signStart = signatureStart(blocks, headerEnd);
  let current: Group | null = null;
  const open = (role: SectionRole, via: Group['via'], first: DocAstBlock): void => {
    current = { role, blocks: [first], via };
    groups.push(current);
  };
  // Taraf ve konu satırları yalnız ilk bölüm başlığından önce aranır (gövde cümlesi
  // "Davacı vekili ...:" yanlışlıkla taraf satırı sayılmasın).
  let inBody = false;
  for (const b of blocks.slice(headerEnd, signStart)) {
    const cur = current as Group | null;
    const role = headingRole(b);
    if (role !== null || b.type === 'heading') inBody = true;
    if (role !== null) {
      open(role, 'heading', b);
    } else if (!inBody && isPartyRow(b)) {
      if (cur?.role === 'partiesGrid') cur.blocks.push(b);
      else open('partiesGrid', 'label', b);
    } else if (!inBody && isSubjectRow(b)) {
      if (cur?.role === 'subjectLine') cur.blocks.push(b);
      else open('subjectLine', 'label', b);
    } else if (b.type === 'heading' || cur === null || cur.via === 'label') {
      open('freeSection', 'free', b);
    } else {
      cur.blocks.push(b);
    }
  }
  if (signStart < blocks.length) {
    groups.push({ role: 'attorneySignature', blocks: blocks.slice(signStart), via: 'label' });
  }
  return groups;
}

function segmentFree(blocks: readonly DocAstBlock[]): Group[] {
  const groups: Group[] = [];
  for (const b of blocks) {
    const last = groups.at(-1);
    if (last === undefined || b.type === 'heading')
      groups.push({ role: 'freeSection', blocks: [b], via: 'free' });
    else last.blocks.push(b);
  }
  return groups;
}

type Build = { role: SectionRole; dropped: Map<string, number> };

function drop(build: Build, feature: string): void {
  build.dropped.set(feature, (build.dropped.get(feature) ?? 0) + 1);
}

function inline(runs: readonly DocAstRun[], build: Build, inHeading: boolean): JSONContent[] {
  const out: JSONContent[] = [];
  for (const r of runs) {
    if (r.kind === 'break') {
      out.push({ type: 'hardBreak' });
      continue;
    }
    const text = sanitizeText(r.text, { role: build.role, singleLine: true });
    if (text === '') continue;
    const marks: { type: string; attrs?: Record<string, unknown> }[] = [];
    if (r.bold && !inHeading) marks.push({ type: 'bold' });
    if (r.italic) marks.push({ type: 'italic' });
    if (r.underline) marks.push({ type: 'underline' });
    if (r.strike) marks.push({ type: 'strike' });
    if (r.href !== null) {
      if (isAllowedHref(r.href)) marks.push({ type: 'link', attrs: { href: r.href } });
      else drop(build, 'link_protocol');
    }
    out.push(marks.length > 0 ? { type: 'text', text, marks } : { type: 'text', text });
  }
  return out;
}

function paragraph(p: DocAstPara, build: Build): JSONContent {
  const content = inline(p.runs, build, false);
  return {
    type: 'paragraph',
    attrs: { align: p.align },
    ...(content.length > 0 ? { content } : {}),
  };
}

function paragraphs(ps: readonly DocAstPara[], build: Build): JSONContent[] {
  const out = ps.map((p) => paragraph(p, build));
  return out.length > 0 ? out : [{ type: 'paragraph', attrs: { align: null } }];
}

function convert(b: DocAstBlock, build: Build, asHeading: boolean): JSONContent[] {
  if (asHeading && (b.type === 'paragraph' || b.type === 'heading')) {
    const content = inline(b.runs, build, true);
    return [
      {
        type: 'heading',
        attrs: {
          level: b.type === 'heading' ? b.level : 1,
          align: b.align === 'left' ? null : b.align,
        },
        ...(content.length > 0 ? { content } : {}),
      },
    ];
  }
  switch (b.type) {
    case 'paragraph':
      return [paragraph(b, build)];
    case 'heading':
      return convert(b, build, true);
    case 'list': {
      if (b.items.length === 0) {
        drop(build, 'empty_list');
        return [];
      }
      const items = b.items.map((i) => ({
        type: 'listItem',
        content: paragraphs(i.paragraphs, build),
      }));
      return [
        b.ordered
          ? { type: 'orderedList', attrs: { start: Math.max(1, b.start) }, content: items }
          : { type: 'bulletList', content: items },
      ];
    }
    case 'table': {
      const rows = b.rows.filter((r) => r.cells.length > 0);
      const cols = Math.max(0, ...rows.map((r) => r.cells.length));
      if (rows.length === 0) {
        drop(build, 'empty_table');
        return [];
      }
      if (rows.length > TABLE_MAX_ROWS || cols > TABLE_MAX_COLS) {
        drop(build, 'table_over_limit');
        return rows.flatMap((r) =>
          r.cells.flatMap((c) => c.paragraphs.map((p) => paragraph(p, build))),
        );
      }
      return [
        {
          type: 'table',
          content: rows.map((r) => ({
            type: 'tableRow',
            content: r.cells.map((c) => ({
              type: c.header ? 'tableHeader' : 'tableCell',
              content: paragraphs(c.paragraphs, build),
            })),
          })),
        },
      ];
    }
  }
}

function sectionJson(
  group: Group,
  role: SectionRole,
  blockId: string,
  dropped: Map<string, number>,
): JSONContent {
  const build: Build = { role, dropped };
  const content = group.blocks.flatMap((b, i) =>
    convert(b, build, i === 0 && group.via === 'heading' && role === group.role),
  );
  return {
    type: 'section',
    attrs: { blockId, rev: 1, role },
    content: content.length > 0 ? content : [{ type: 'paragraph', attrs: { align: null } }],
  };
}

export function fromDocAst(ast: DocAstDocument, ctx: FromDocAstContext): FromDocAstResult {
  const blocks = ast.sections.flatMap((s) => s.blocks);
  const groups = ctx.kind === 'petition' ? segmentPetition(blocks) : segmentFree(blocks);
  if (groups.length === 0) groups.push({ role: 'freeSection', blocks: [], via: 'free' });

  const makeId = ctx.newBlockId ?? ((existing: ReadonlySet<string>) => newBlockId(existing));
  const ids = new Set<string>();
  const dropped = new Map<string, number>();
  const warnings: string[] = [...(ctx.engineReport?.warnings ?? [])];
  const sections: JSONContent[] = [];
  const recognizedRoles: ImportReportDto['recognizedRoles'] = [];
  let freeSectionCount = 0;

  for (const group of groups) {
    const blockId = makeId(ids);
    ids.add(blockId);
    let role = group.role;
    let json = sectionJson(group, role, blockId, new Map());
    if (role !== 'freeSection') {
      const parsed = parseSectionJson(json);
      const bad =
        parsed.doc === null || hasErrors(validateSection(parsed.doc, { profile: 'user' }));
      if (bad) {
        role = 'freeSection';
        warnings.push(WARN_DOWNGRADED);
      }
    }
    json = sectionJson(group, role, blockId, dropped);
    sections.push(json);
    if (role === 'freeSection') freeSectionCount++;
    else recognizedRoles.push({ role, blockId });
  }

  for (const f of ctx.engineReport?.droppedFeatures ?? []) {
    dropped.set(f.feature, (dropped.get(f.feature) ?? 0) + f.count);
  }
  const droppedFeatures = [...dropped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([feature, count]) => ({ feature, count }));

  const today = ctx.today ?? null;
  const citationCandidates =
    today === null ? 0 : extractAll(blocks.map(blockText).join('\n'), { today }).citations.length;

  return {
    doc: { type: 'doc', content: sections },
    report: {
      recognizedRoles,
      freeSectionCount,
      hiddenContentSkipped: ctx.engineReport?.hiddenContentSkipped ?? 0,
      droppedFeatures,
      citationCandidates,
      warnings,
    },
  };
}
