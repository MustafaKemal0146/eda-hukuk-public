// Belge bloğu (sohbet belge kartı): model belge metnini ```belge çitli tek blokta yazar (chat.core
// sürüm 4); sohbet gövdesinde metin yerine "Belgeyi görüntüle" kartı çizilir, metin sağ panelde açılır.
// Ayrıştırma yalnız metin üzerindedir: sunucu şeması ve kalıcı mesaj biçimi değişmez, yeniden
// yüklemede aynı bloktan aynı kart çıkar. Akışta kapanmamış blok `complete: false` ile döner.

export type DocumentBlock = {
  type: 'document';
  /** Mesaj içindeki sıra; kart ve panel bu sırayla eşlenir. */
  index: number;
  title: string;
  /** Başlık satırı çıkarılmış belge metni (markdown). */
  body: string;
  complete: boolean;
};

export type ChatSegment = { type: 'text'; value: string } | DocumentBlock;

const OPEN = /^[ \t]{0,3}(```|~~~)[ \t]*belge[ \t]*\n/im;
/** Akışta henüz tamamlanmamış açılış çiti ("```be"): ham görünmesin. */
const PARTIAL_OPEN = /(?:^|\n)[ \t]{0,3}(?:```|~~~)[ \t]*b?e?l?g?e?[ \t]*$/i;

function titleOf(raw: string): { title: string; body: string } {
  const lines = raw.replace(/^\s+/, '').split('\n');
  const first = (lines.shift() ?? '').replace(/^[#*_>\s]+|[*_\s]+$/g, '').trim();
  return { title: first, body: lines.join('\n').replace(/^\s+/, '') };
}

export function splitDocuments(text: string): ChatSegment[] {
  const out: ChatSegment[] = [];
  let rest = text;
  let index = 0;
  for (;;) {
    const open = OPEN.exec(rest);
    if (!open) break;
    const fence = open[1] ?? '```';
    const before = rest.slice(0, open.index);
    const after = rest.slice(open.index + open[0].length);
    const close = new RegExp(`^[ \\t]{0,3}${fence}[ \\t]*$`, 'm').exec(after);
    if (before.trim() !== '') out.push({ type: 'text', value: before });
    const raw = close ? after.slice(0, close.index) : after;
    const { title, body } = titleOf(raw);
    out.push({ type: 'document', index, title, body, complete: close !== null });
    index += 1;
    if (!close) {
      rest = '';
      break;
    }
    rest = after.slice(close.index + close[0].length).replace(/^\n/, '');
  }
  const tail = rest.replace(PARTIAL_OPEN, '');
  if (tail.trim() !== '') out.push({ type: 'text', value: tail });
  return out.length === 0 ? [{ type: 'text', value: text }] : out;
}

export function documentsOf(text: string): DocumentBlock[] {
  return splitDocuments(text).filter((s): s is DocumentBlock => s.type === 'document');
}

export function wordCount(text: string): number {
  return text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
}

// --- Doldurulacak alan vurgusu (rehype) ----------------------------------------------------------

/** Çip öğesi gibi: `[[Doldurulacak: ...]]` işaretleri `<mark>` olur; avukat boşlukları görür. */
const PLACEHOLDER_RE = /\[\[[^[\]\n]{1,200}\]\]/g;
const SKIP = new Set(['code', 'pre', 'a', 'kbd', 'samp']);

type HNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
};

function mark(children: HNode[]): HNode[] {
  const out: HNode[] = [];
  for (const c of children) {
    if (c.type === 'text' && typeof c.value === 'string') {
      let last = 0;
      for (const m of c.value.matchAll(PLACEHOLDER_RE)) {
        const start = m.index ?? 0;
        if (start > last) out.push({ type: 'text', value: c.value.slice(last, start) });
        out.push({
          type: 'element',
          tagName: 'mark',
          properties: { dataPlaceholder: '' },
          children: [{ type: 'text', value: m[0] }],
        });
        last = start + m[0].length;
      }
      if (last === 0) out.push(c);
      else if (last < c.value.length) out.push({ type: 'text', value: c.value.slice(last) });
      continue;
    }
    if (c.type === 'element' && c.tagName && SKIP.has(c.tagName)) {
      out.push(c);
      continue;
    }
    if (c.children) c.children = mark(c.children);
    out.push(c);
  }
  return out;
}

export function rehypePlaceholders() {
  return (tree: { children?: unknown }) => {
    if (Array.isArray(tree.children)) tree.children = mark(tree.children as HNode[]);
  };
}
