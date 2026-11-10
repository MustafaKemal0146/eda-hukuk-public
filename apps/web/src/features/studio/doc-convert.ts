// Belge biçim dönüşümleri (DOM'suz, saf): sohbet belge bloğunun markdown'ı -> editör JSON'u ve
// editör JSON'u -> düz bloklar (DOCX yazıcı girdisi). Kural: yeni metin üretilmez; yalnız yapı taşınır.
import { newBlockId } from '@eda/editor/schema';

export type Mark = 'bold' | 'italic' | 'underline';
export type Run = { text: string; marks: Mark[] };
export type Block =
  | { kind: 'p'; runs: Run[]; align: 'left' | 'center' | 'right' | 'justify' | null }
  | { kind: 'h'; level: 1 | 2; runs: Run[] }
  | { kind: 'li'; ordered: boolean; index: number; runs: Run[] };

// --- markdown -> bloklar ----------------------------------------------------------------------

const INLINE = /\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|__([^_]+)__/g;

/** `**kalın**`, `*italik*`, `__altı çizili__` işaretlerini çalıştırmalara böler. */
export function parseInline(text: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) runs.push({ text: text.slice(last, at), marks: [] });
    if (m[1] !== undefined) runs.push({ text: m[1], marks: ['bold'] });
    else if (m[2] !== undefined) runs.push({ text: m[2], marks: ['italic'] });
    else if (m[3] !== undefined) runs.push({ text: m[3], marks: ['underline'] });
    last = at + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), marks: [] });
  return runs.filter((r) => r.text !== '');
}

/**
 * Belge metninde tek satır sonu anlamlıdır ("DAVACI : …" / "VEKİLİ : …"): markdown'ın "yumuşak satır"
 * birleştirmesi yerine her metin satırı ayrı paragraf olur; liste ve başlık satırları olduğu gibi kalır.
 */
export function separateLines(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    out.push(line);
    const next = lines[i + 1];
    const plain = (l: string) => l.trim() !== '' && !/^\s*([-*•]|\d+[.)]|#{1,6})\s/.test(l);
    if (next !== undefined && plain(line) && plain(next)) out.push('');
  }
  return out.join('\n');
}

export function markdownToBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let ordinal = 0;
  const flush = () => {
    if (para.length === 0) return;
    const runs = parseInline(para.join(' '));
    if (runs.length > 0) blocks.push({ kind: 'p', runs, align: null });
    para = [];
  };
  for (const raw of separateLines(markdown).split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flush();
      ordinal = 0;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: 'h',
        level: (heading[1] ?? '#').length === 1 ? 1 : 2,
        runs: parseInline(heading[2] ?? ''),
      });
    } else if (bullet) {
      flush();
      blocks.push({ kind: 'li', ordered: false, index: 0, runs: parseInline(bullet[1] ?? '') });
    } else if (numbered) {
      flush();
      ordinal += 1;
      blocks.push({
        kind: 'li',
        ordered: true,
        index: ordinal,
        runs: parseInline(numbered[1] ?? ''),
      });
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

// --- bloklar -> editör JSON'u -----------------------------------------------------------------

type Json = Record<string, unknown>;

const textNodes = (runs: Run[]): Json[] =>
  runs.map((r) => ({
    type: 'text',
    text: r.text,
    ...(r.marks.length > 0 ? { marks: r.marks.map((type) => ({ type })) } : {}),
  }));

const paragraph = (runs: Run[]): Json => ({
  type: 'paragraph',
  ...(runs.length > 0 ? { content: textNodes(runs) } : {}),
});

/** Bloklar -> bölüm içi düğümler (paragraf, başlık, liste); ardışık liste öğeleri tek liste olur. */
export function blocksToContent(blocks: readonly Block[]): Json[] {
  const out: Json[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (!b) break;
    if (b.kind === 'li') {
      const items: Json[] = [];
      const ordered = b.ordered;
      while (i < blocks.length) {
        const n = blocks[i];
        if (n?.kind !== 'li' || n.ordered !== ordered) break;
        items.push({ type: 'listItem', content: [paragraph(n.runs)] });
        i += 1;
      }
      out.push({ type: ordered ? 'orderedList' : 'bulletList', content: items });
    } else {
      i += 1;
      out.push(
        b.kind === 'h'
          ? { type: 'heading', attrs: { level: b.level }, content: textNodes(b.runs) }
          : paragraph(b.runs),
      );
    }
  }
  return out;
}

/** Her blok ayrı `freeSection` olur (rol tanıma kullanıcıya/P18'e bırakılır; uydurma rol yok). */
export function blocksToDoc(blocks: Block[]): { type: 'doc'; content: Json[] } {
  const sections: Json[] = blocksToContent(blocks).map((content) => ({
    type: 'section',
    attrs: { blockId: newBlockId(), role: 'freeSection', rev: 0 },
    content: [content],
  }));
  if (sections.length === 0) {
    sections.push({
      type: 'section',
      attrs: { blockId: newBlockId(), role: 'freeSection', rev: 0 },
      content: [{ type: 'paragraph' }],
    });
  }
  return { type: 'doc', content: sections };
}

export function markdownToDoc(markdown: string): { type: 'doc'; content: Json[] } {
  return blocksToDoc(markdownToBlocks(markdown));
}

// --- editör JSON'u -> bloklar ----------------------------------------------------------------

type Node = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string }[];
  content?: Node[];
};

function runsOf(node: Node): Run[] {
  if (node.type === 'text' && typeof node.text === 'string') {
    const marks = (node.marks ?? [])
      .map((m) => m.type)
      .filter((t): t is Mark => t === 'bold' || t === 'italic' || t === 'underline');
    return [{ text: node.text, marks }];
  }
  if (node.type === 'hardBreak') return [{ text: '\n', marks: [] }];
  return (node.content ?? []).flatMap(runsOf);
}

export function docToBlocks(doc: Node): Block[] {
  const out: Block[] = [];
  const walk = (n: Node): void => {
    switch (n.type) {
      case 'heading':
        out.push({ kind: 'h', level: n.attrs?.level === 1 ? 1 : 2, runs: runsOf(n) });
        return;
      case 'paragraph': {
        const align = n.attrs?.align;
        out.push({
          kind: 'p',
          runs: runsOf(n),
          align:
            align === 'left' || align === 'center' || align === 'right' || align === 'justify'
              ? align
              : null,
        });
        return;
      }
      case 'bulletList':
      case 'orderedList': {
        let idx = 0;
        for (const item of n.content ?? []) {
          idx += 1;
          out.push({
            kind: 'li',
            ordered: n.type === 'orderedList',
            index: idx,
            runs: (item.content ?? []).flatMap(runsOf),
          });
        }
        return;
      }
      default:
        for (const c of n.content ?? []) walk(c);
    }
  };
  walk(doc);
  return out;
}
