// UDF okuyucu/yazıcı (tarayıcı). UDF, `content.xml` taşıyan bir ZIP'tir: tek metin havuzu (CDATA) ve
// havuza `startOffset`/`length` (UTF-16 kod birimi) ile bağlanan paragraf/çalıştırma öğeleri.
// Yazıcı doc-engine `udf/profile.py` hipotez varsayılanlarını izler; çıktının UYAP Doküman
// Editörü'nde açıldığı gerçek örneklerle doğrulanmamıştır (084 §2.1, KK-084-20) ve arayüzde öyle söylenir.
import type { Block, Mark, Run } from '../studio/doc-convert.ts';
import { zipStore } from '../studio/docx-writer.ts';
import { parseXml, type XmlNode } from './xml-lite.ts';
import { ZipError, zipRead } from './zip-reader.ts';

export type ConvertNote = 'tableFlattened' | 'imagesDropped' | 'headerFooterDropped';
export type Converted = { blocks: Block[]; notes: ConvertNote[] };

const FORMAT_ID = '1.8';
const RESOLVER = 'hvl-default';
const FONT = 'Times New Roman';
const MARGINS = { left: 70.866, right: 56.693, top: 56.693, bottom: 56.693 };
const FIRST_LINE_PT = 35.433;
const EMPTY_MARK = '\u200b';
const ALIGN_FROM = ['left', 'center', 'right', 'justify'] as const;
const ALIGN_CODE = { left: '0', center: '1', right: '2', justify: '3' } as const;

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8');

const isTruthy = (v: string | undefined): boolean => v !== undefined && /^true$/i.test(v);

/** Kaçış: öznitelik ve öğe metni. */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s: string): string => `<![CDATA[${s.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

// --- okuma -----------------------------------------------------------------------------------

/** Açılan toplam metin üst sınırı: aynı havuz aralığına işaret eden çok sayıda öğe belleği şişirmesin. */
const MAX_TOTAL_CHARS = 5_000_000;
let budget = MAX_TOTAL_CHARS;

function runsOf(paragraph: XmlNode, pool: string): Run[] {
  const runs: Run[] = [];
  for (const child of paragraph.children) {
    const tag = child.local;
    if (tag === 'tab') {
      runs.push({ text: '\t', marks: [] });
      continue;
    }
    if (tag === 'space') {
      runs.push({ text: ' ', marks: [] });
      continue;
    }
    if (tag !== 'content') continue;
    const start = Number(child.attrs.startOffset);
    const length = Number(child.attrs.length);
    if (!Number.isFinite(start) || !Number.isFinite(length) || start < 0 || length <= 0) continue;
    const text = pool
      .slice(start, start + length)
      .replace(/\r?\n$/, '')
      .replaceAll(EMPTY_MARK, '');
    if (text === '') continue;
    budget -= text.length;
    if (budget < 0) throw new ZipError('too-large');
    const marks: Mark[] = [];
    if (isTruthy(child.attrs.bold)) marks.push('bold');
    if (isTruthy(child.attrs.italic)) marks.push('italic');
    if (isTruthy(child.attrs.underline)) marks.push('underline');
    runs.push({ text, marks });
  }
  return runs;
}

/** `content.xml` metninden blokları çıkarır. */
export function parseUdfXml(xml: string): Converted {
  let root: XmlNode;
  budget = MAX_TOTAL_CHARS;
  try {
    root = parseXml(xml);
  } catch {
    throw new ZipError('bad-udf');
  }
  if (root.local !== 'template') throw new ZipError('bad-udf');
  const pool = root.children.find((c) => c.local === 'content')?.text;
  const elements = root.children.find((c) => c.local === 'elements');
  if (elements === undefined || pool === undefined) throw new ZipError('bad-udf');

  const notes = new Set<ConvertNote>();
  const blocks: Block[] = [];
  let ordinal = 0;
  let lastList: string | null = null;
  const addParagraph = (p: XmlNode) => {
    const runs = runsOf(p, pool);
    const numbered = isTruthy(p.attrs.Numbered);
    const bulleted = isTruthy(p.attrs.Bulleted);
    if (numbered || bulleted) {
      const id = p.attrs.ListId ?? '';
      ordinal = numbered && id === lastList ? ordinal + 1 : 1;
      lastList = id;
      blocks.push({ kind: 'li', ordered: numbered, index: numbered ? ordinal : 0, runs });
      return;
    }
    lastList = null;
    ordinal = 0;
    const align = ALIGN_FROM[Number(p.attrs.Alignment ?? '0')] ?? 'left';
    blocks.push({ kind: 'p', runs, align: align === 'left' ? null : align });
  };

  const walk = (node: XmlNode) => {
    for (const el of node.children) {
      switch (el.local) {
        case 'paragraph':
          addParagraph(el);
          break;
        case 'table':
          notes.add('tableFlattened');
          walk(el);
          break;
        case 'row':
        case 'cell':
          walk(el);
          break;
        case 'header':
        case 'footer':
          notes.add('headerFooterDropped');
          break;
        case 'image':
          notes.add('imagesDropped');
          break;
        default:
          break;
      }
    }
  };
  walk(elements);

  // Hiç paragraf çıkmadıysa havuz satır satır paragraf sayılır (alışılmadık dosyalar için).
  if (blocks.length === 0 && pool.trim() !== '') {
    for (const line of pool.split(/\r?\n/)) {
      const clean = line.replaceAll(EMPTY_MARK, '');
      blocks.push({
        kind: 'p',
        runs: clean === '' ? [] : [{ text: clean, marks: [] }],
        align: null,
      });
    }
  }
  // Baştaki/sondaki boş paragraflar atılır.
  const empty = (b: Block) => b.runs.every((r) => r.text.trim() === '');
  while (blocks.length > 0 && empty(blocks[0] as Block)) blocks.shift();
  while (blocks.length > 0 && empty(blocks[blocks.length - 1] as Block)) blocks.pop();
  return { blocks, notes: [...notes] };
}

export async function readUdf(bytes: Uint8Array): Promise<Converted> {
  const content = await zipRead(bytes, 'content.xml');
  if (content === null) throw new ZipError('bad-udf');
  return parseUdfXml(dec.decode(content));
}

// --- yazma -----------------------------------------------------------------------------------

type Piece = { text: string; marks: readonly Mark[] };
type Para = { attrs: [string, string][]; pieces: Piece[] };

const num = (n: number): string => {
  const t = n.toFixed(3).replace(/0+$/, '');
  return t.endsWith('.') ? `${t}0` : t;
};

function paraOf(b: Block): Para {
  const base = (
    align: keyof typeof ALIGN_CODE,
    first: number,
    left: number,
  ): [string, string][] => [
    ['Alignment', ALIGN_CODE[align]],
    ['LeftIndent', num(left)],
    ['RightIndent', '0.0'],
    ['FirstLineIndent', num(first)],
    ['LineSpacing', '0.5'],
    ['SpaceAbove', '0.0'],
    ['SpaceBelow', '6.0'],
  ];
  if (b.kind === 'h') {
    return {
      attrs: base('left', 0, 0),
      pieces: b.runs.map((r) => ({
        text: r.text,
        marks: [...new Set<Mark>([...r.marks, 'bold'])],
      })),
    };
  }
  if (b.kind === 'li') {
    return {
      attrs: [
        ...base('justify', 0, 0),
        ...(b.ordered
          ? ([
              ['Numbered', 'true'],
              ['NumberType', 'NUMBER_TYPE_NUMBER_DOT'],
            ] as [string, string][])
          : ([
              ['Bulleted', 'true'],
              ['BulletType', 'BULLET_TYPE_ELLIPSE'],
            ] as [string, string][])),
        ['ListId', b.ordered ? '1' : '2'],
        ['ListLevel', '0'],
      ],
      pieces: b.runs,
    };
  }
  const align = b.align ?? 'justify';
  return {
    attrs: base(align, b.align === null || b.align === 'justify' ? FIRST_LINE_PT : 0, 0),
    pieces: b.runs,
  };
}

/** Bloklardan UDF `content.xml` metni üretir (başlık verilirse ortalanmış kalın ilk paragraf). */
export function buildUdfXml(title: string, blocks: readonly Block[]): string {
  const all: Block[] = [
    ...(title.trim() === ''
      ? []
      : [{ kind: 'p', align: 'center', runs: [{ text: title.trim(), marks: ['bold'] }] } as Block]),
    ...blocks,
  ];
  const paras = all.map(paraOf);
  let pool = '';
  let offset = 0;
  const body: string[] = [];
  paras.forEach((para, k) => {
    const pieces = para.pieces
      .map((p) => ({ ...p, text: p.text.replace(/\r?\n/g, ' ') }))
      .filter((p) => p.text !== '');
    const parts: string[] = [];
    const sourcePieces = pieces.length === 0 ? [{ text: EMPTY_MARK, marks: [] as Mark[] }] : pieces;
    for (const piece of sourcePieces) {
      // Sekme: havuzda `\t` + `<tab/>` öğesi.
      const segments = piece.text.split('\t');
      segments.forEach((seg, i) => {
        if (i > 0) {
          parts.push(`<tab startOffset="${offset}" length="1"/>`);
          pool += '\t';
          offset += 1;
        }
        if (seg === '') return;
        const length = seg.length; // JS dizgi uzunluğu = UTF-16 kod birimi
        const flag = (m: Mark) => (piece.marks.includes(m) ? 'true' : 'false');
        parts.push(
          `<content startOffset="${offset}" length="${length}" family="${FONT}" size="12" bold="${flag('bold')}" italic="${flag('italic')}" underline="${flag('underline')}" foreground="-16777216"/>`,
        );
        pool += seg;
        offset += length;
      });
    }
    if (k < paras.length - 1) {
      pool += '\n';
      offset += 1;
    }
    const attrs = para.attrs.map(([n, v]) => ` ${n}="${esc(v)}"`).join('');
    body.push(`<paragraph${attrs}>${parts.join('')}</paragraph>`);
  });
  const page = `<pageFormat mediaSizeName="1" leftMargin="${num(MARGINS.left)}" rightMargin="${num(MARGINS.right)}" topMargin="${num(MARGINS.top)}" bottomMargin="${num(MARGINS.bottom)}" paperOrientation="1" headerFOffset="20.0" footerFOffset="20.0"/>`;
  const styles = `<styles><style name="default" family="${FONT}" size="12" bold="false" italic="false" foreground="-16777216"/><style name="${RESOLVER}" family="${FONT}" size="12"/></styles>`;
  return `<?xml version="1.0" encoding="UTF-8" ?>\n<template format_id="${FORMAT_ID}"><content>${cdata(pool)}</content><properties>${page}</properties><elements resolver="${RESOLVER}">${body.join('')}</elements>${styles}</template>`;
}

export function buildUdfBytes(title: string, blocks: readonly Block[]): Uint8Array {
  return zipStore([{ name: 'content.xml', data: enc.encode(buildUdfXml(title, blocks)) }]);
}
