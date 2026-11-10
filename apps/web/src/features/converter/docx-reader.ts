// DOCX okuyucu (tarayıcı): `word/document.xml` içindeki paragrafları, kalın/italik/altı çizili
// çalıştırmaları, hizalamayı, başlıkları ve madde/numara imli paragrafları bloklara çevirir. Tablolar
// paragraf olarak düzleştirilir, görseller atılır; bu durumlar kullanıcıya not olarak bildirilir.
import type { Block, Mark, Run } from '../studio/doc-convert.ts';
import type { Converted, ConvertNote } from './udf-codec.ts';
import { parseXml, type XmlNode } from './xml-lite.ts';
import { ZipError, zipRead } from './zip-reader.ts';

const dec = new TextDecoder('utf-8');

/** `w:val` öznitelik değeri; ön ek ne olursa olsun yerel adla aranır. */
function val(el: XmlNode | null | undefined): string | undefined {
  if (!el) return undefined;
  for (const [k, v] of Object.entries(el.attrs)) {
    if (k === 'w:val' || k === 'val') return v;
  }
  return undefined;
}

function on(el: XmlNode | null): boolean {
  if (!el) return false;
  const v = val(el);
  return v === undefined || !['false', '0', 'off', 'none'].includes(v);
}

function child(el: XmlNode, local: string): XmlNode | null {
  return el.children.find((c) => c.local === local) ?? null;
}

function runOf(r: XmlNode): Run | null {
  const props = child(r, 'rPr');
  const marks: Mark[] = [];
  if (props) {
    if (on(child(props, 'b'))) marks.push('bold');
    if (on(child(props, 'i'))) marks.push('italic');
    const u = child(props, 'u');
    if (u && val(u) !== 'none') marks.push('underline');
  }
  let text = '';
  for (const c of r.children) {
    if (c.local === 't') text += c.text;
    else if (c.local === 'tab') text += '\t';
    else if (c.local === 'br' || c.local === 'cr') text += '\n';
  }
  return text === '' ? null : { text, marks };
}

function paragraphRuns(p: XmlNode): Run[] {
  const runs: Run[] = [];
  const visit = (node: XmlNode) => {
    for (const c of node.children) {
      if (c.local === 'r') {
        const run = runOf(c);
        if (run) runs.push(run);
      } else if (c.local === 'hyperlink' || c.local === 'ins' || c.local === 'smartTag') {
        visit(c);
      }
    }
  };
  visit(p);
  return runs;
}

function has(node: XmlNode, local: string): boolean {
  return node.children.some((c) => c.local === local || has(c, local));
}

/** Aynı işaretli bitişik çalıştırmaları birleştirir. */
function merge(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const last = out[out.length - 1];
    if (last && last.marks.join() === r.marks.join()) last.text += r.text;
    else out.push({ text: r.text, marks: [...r.marks] });
  }
  return out;
}

export async function readDocx(bytes: Uint8Array): Promise<Converted> {
  const raw = await zipRead(bytes, 'word/document.xml');
  if (raw === null) throw new ZipError('bad-docx');
  let root: XmlNode;
  try {
    root = parseXml(dec.decode(raw));
  } catch {
    throw new ZipError('bad-docx');
  }
  const body = child(root, 'body');
  if (root.local !== 'document' || !body) throw new ZipError('bad-docx');

  const notes = new Set<ConvertNote>();
  const blocks: Block[] = [];
  const counters = new Map<string, number>();

  const addParagraph = (p: XmlNode) => {
    if (has(p, 'drawing') || has(p, 'pict')) notes.add('imagesDropped');
    const runs = merge(paragraphRuns(p));
    const props = child(p, 'pPr');
    const style = (props ? val(child(props, 'pStyle')) : undefined) ?? '';
    const numPr = props ? child(props, 'numPr') : null;
    const jc = (props ? val(child(props, 'jc')) : undefined) ?? '';
    const heading = /^(heading|başlık|baslik|title)\s*([0-9])?/i.exec(style);
    if (heading && runs.length > 0) {
      blocks.push({
        kind: 'h',
        level: heading[2] === '1' || /^title$/i.test(heading[1] ?? '') ? 1 : 2,
        runs,
      });
      return;
    }
    if (numPr) {
      const numId = val(child(numPr, 'numId')) ?? '0';
      if (numId !== '0') {
        // Numara biçimi numbering.xml'den okunmaz: "madde" stili işaretli, aksi hâlde numaralıdır.
        const ordered = !/bullet|madde/i.test(style);
        const n = (counters.get(numId) ?? 0) + 1;
        counters.set(numId, n);
        blocks.push({ kind: 'li', ordered, index: ordered ? n : 0, runs });
        return;
      }
    }
    const align =
      jc === 'center'
        ? 'center'
        : jc === 'right' || jc === 'end'
          ? 'right'
          : jc === 'both'
            ? 'justify'
            : null;
    blocks.push({ kind: 'p', runs, align });
  };

  const walk = (node: XmlNode) => {
    for (const el of node.children) {
      if (el.local === 'p') addParagraph(el);
      else if (el.local === 'tbl') {
        notes.add('tableFlattened');
        walk(el);
      } else if (['tr', 'tc', 'sdt', 'sdtContent'].includes(el.local)) {
        walk(el);
      }
    }
  };
  walk(body);

  const empty = (b: Block) => b.runs.every((r) => r.text.trim() === '');
  while (blocks.length > 0 && empty(blocks[0] as Block)) blocks.shift();
  while (blocks.length > 0 && empty(blocks[blocks.length - 1] as Block)) blocks.pop();
  return { blocks, notes: [...notes] };
}
