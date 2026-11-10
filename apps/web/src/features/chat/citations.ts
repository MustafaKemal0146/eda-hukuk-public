// `[K#]` etiket işleme (025 §4.4; 053-02 §5.3). Model künye yazmaz, etiket yazar; ekranda etiket kısa
// künye çipine döner (künye `data-sources` kaydından). Yalnız TAM etiket işlenir; akışta yarım kalan
// `[K` / `[K3` ham metin kalır. Kod, satır içi kod ve bağlantı metni içinde etiket işlenmez.

/** Tam etiket: `[K3]` ve toleranslı çoklu biçim `[K3, K5]`. */
const CITATION_RE = /\[(K[1-9]\d{0,3}(?:\s*,\s*K[1-9]\d{0,3})*)\]/g;
const REF_RE = /K[1-9]\d{0,3}/g;

export type CitationSegment = { type: 'text'; value: string } | { type: 'cite'; refs: string[] };

export function splitCitations(text: string): CitationSegment[] {
  const out: CitationSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push({ type: 'cite', refs: (m[1] ?? '').match(REF_RE) ?? [] });
    last = start + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Metindeki benzersiz etiketler, ilk geçiş sırasıyla. */
export function citedRefs(text: string): string[] {
  const seen = new Set<string>();
  for (const s of splitCitations(text)) if (s.type === 'cite') for (const r of s.refs) seen.add(r);
  return [...seen];
}

const PARTIAL_TAIL = /\[((?:K[\dK,\s]{0,40})?)$/;

function insideCodeAtEnd(text: string): boolean {
  const fences = text.match(/^\s{0,3}(```|~~~)/gm)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const lastLine = text.slice(text.lastIndexOf('\n') + 1);
  return (lastLine.match(/`/g)?.length ?? 0) % 2 === 1;
}

/**
 * Akış sonundaki yarım etiketi (`[`, `[K`, `[K3`, `[K3, K`) korur: streamdown'ın eksik bağlantı
 * tamamlayıcısı bunu bağlantıya çevirmesin diye `[` karakter referansıyla (`&#91;`) yazılır; ekranda
 * ham `[K3` görünür. Kod bloğu içindeyse dokunulmaz.
 */
/** İç araç adları kullanıcıya gösterilmez (#62): model yazsa bile okunur karşılığıyla değiştirilir. */
const TOOL_NAME_LABELS: readonly [RegExp, string][] = [
  [/\bget_legislation_article\b/g, 'madde metni getirme'],
  [/\bsearch_legislation\b/g, 'mevzuat araması'],
  [/\bsearch_decisions\b/g, 'karar araması'],
  [/\bget_decision\b/g, 'karar metni getirme'],
  [/\bsearch_case_files\b/g, 'dosya araması'],
  [/\bcalculate_deadline\b/g, 'süre hesabı'],
  [/\bcreate_document\b/g, 'belge hazırlama'],
  [/\bedit_document\b/g, 'belge düzenleme'],
  [/\bsubmit_outline\b/g, 'belge planı'],
];

export function hideToolNames(text: string): string {
  let out = text;
  for (const [re, label] of TOOL_NAME_LABELS) out = out.replace(re, label);
  return out;
}

export function protectPartialCitation(text: string): string {
  const m = PARTIAL_TAIL.exec(text);
  if (!m || insideCodeAtEnd(text)) return text;
  return `${text.slice(0, m.index)}&#91;${m[1] ?? ''}`;
}

// --- rehype eklentisi (streamdown sanitize SONRASI çalışır) ----------------------------------

/** Çip öğesinin hast etiket adı; MessageContent bu adı `SourceChip`e eşler. */
export const CITE_TAG = 'eda-cite';

type HastText = { type: 'text'; value: string };
type HastElement = {
  type: 'element';
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
};
type HastNode = HastText | HastElement | { type: string; children?: HastNode[] };

const SKIP_TAGS = new Set(['code', 'pre', 'a', 'kbd', 'samp']);

function isElement(n: HastNode): n is HastElement {
  return n.type === 'element';
}

function transformChildren(children: HastNode[]): HastNode[] {
  // Bitişik metin düğümleri birleştirilir: etiket iki düğüme bölünmüş olabilir.
  const merged: HastNode[] = [];
  for (const c of children) {
    const prev = merged.at(-1);
    if (c.type === 'text' && prev?.type === 'text') {
      (prev as HastText).value += (c as HastText).value;
    } else {
      merged.push(c.type === 'text' ? { type: 'text', value: (c as HastText).value } : c);
    }
  }
  const out: HastNode[] = [];
  for (const c of merged) {
    if (c.type === 'text') {
      for (const seg of splitCitations((c as HastText).value)) {
        out.push(
          seg.type === 'text'
            ? { type: 'text', value: seg.value }
            : {
                type: 'element',
                tagName: CITE_TAG,
                properties: { dataRefs: seg.refs.join(' ') },
                children: [],
              },
        );
      }
      continue;
    }
    if (isElement(c) && SKIP_TAGS.has(c.tagName)) {
      out.push(c);
      continue;
    }
    if ('children' in c && Array.isArray(c.children)) c.children = transformChildren(c.children);
    out.push(c);
  }
  return out;
}

/** `[K#]` metnini `<eda-cite data-refs="K1 K3">` öğesine çevirir (yerinde). */
export function rehypeCitations() {
  return (tree: { children?: unknown }) => {
    if (Array.isArray(tree.children)) {
      tree.children = transformChildren(tree.children as HastNode[]);
    }
  };
}

/** `data-refs` özniteliğini okur (hast `dataRefs` veya React prop `data-refs`). */
export function refsFromProps(props: Record<string, unknown>): string[] {
  const node = props.node as { properties?: Record<string, unknown> } | undefined;
  const raw = props['data-refs'] ?? node?.properties?.dataRefs;
  const value = Array.isArray(raw) ? raw.join(' ') : typeof raw === 'string' ? raw : '';
  return value.match(REF_RE) ?? [];
}

// --- Kopyalama serileştirmesi (052 §5.1 MessageActions) --------------------------------------

export type CopySource = { shortKunye: string; title: string };

/** Etiketler kısa künyeyle yazılır, sonda atıf yapılan kaynakların listesi (defter §28.10). */
export function serializeForCopy(
  text: string,
  sources: ReadonlyMap<string, CopySource>,
  heading: string,
): string {
  const body = splitCitations(text)
    .map((s) => {
      if (s.type === 'text') return s.value;
      const names = s.refs.map((r) => sources.get(r)?.shortKunye);
      return names.every((n) => n !== undefined)
        ? `(${names.join('; ')})`
        : `[${s.refs.join(', ')}]`;
    })
    .join('');
  const listed = citedRefs(text).flatMap((r) => {
    const s = sources.get(r);
    return s ? [`- ${s.shortKunye}${s.title ? ` — ${s.title}` : ''}`] : [];
  });
  return listed.length === 0 ? body : `${body.trimEnd()}\n\n${heading}\n${listed.join('\n')}\n`;
}
