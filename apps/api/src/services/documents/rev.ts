// Blok `rev` hesabı (054 §3.2; P17b.6): `rev` sunucuya aittir. İstemcinin gönderdiği değer YOK
// SAYILIR; her `section` için kayıtlı blokla kanonik özet (rev hariç) karşılaştırılır: aynıysa kayıtlı
// `rev`, farklıysa kayıtlı `rev + 1`, kayıtlı olmayan `blockId` için 1.
import type { DocJson, SectionJson } from '@eda/editor/diff';
import { blockDigest } from '@eda/editor/hash';

export type { DocJson, SectionJson };

export interface RevResult {
  /** `rev` değerleri sunucuca yazılmış belge. */
  readonly doc: DocJson;
  readonly blockRevs: Record<string, number>;
}

export async function computeBlockRevs(
  stored: DocJson | null,
  incoming: DocJson,
): Promise<RevResult> {
  const known = new Map<string, { digest: string; rev: number }>();
  for (const s of stored?.content ?? []) {
    known.set(s.attrs.blockId, { digest: await blockDigest(s), rev: s.attrs.rev ?? 0 });
  }
  const blockRevs: Record<string, number> = {};
  const content: SectionJson[] = [];
  for (const s of incoming.content) {
    const prev = known.get(s.attrs.blockId);
    let rev = 1;
    if (prev !== undefined) {
      rev = prev.digest === (await blockDigest(s)) ? prev.rev : prev.rev + 1;
    }
    blockRevs[s.attrs.blockId] = rev;
    content.push({ ...s, attrs: { ...s.attrs, rev } });
  }
  return { doc: { ...incoming, content }, blockRevs };
}

/** Bir belgedeki `citation` düğümleri ve bulundukları blok (`citationId` + `raw`). */
export interface CitationNode {
  readonly citationId: string;
  readonly raw: string;
  readonly blockId: string;
}

export function citationNodesOf(doc: DocJson): CitationNode[] {
  const out: CitationNode[] = [];
  const walk = (node: unknown, blockId: string): void => {
    if (node === null || typeof node !== 'object') return;
    const n = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown[] };
    if (n.type === 'citation') {
      const id = n.attrs?.citationId;
      const raw = n.attrs?.raw;
      if (typeof id === 'string' && typeof raw === 'string')
        out.push({ citationId: id, raw, blockId });
      return;
    }
    for (const c of n.content ?? []) walk(c, blockId);
  };
  for (const s of doc.content) for (const c of s.content ?? []) walk(c, s.attrs.blockId);
  return out;
}
