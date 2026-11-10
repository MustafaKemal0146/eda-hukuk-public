// Belge atıf kaydı (025 §12.4; P17b.6). P13'ün atıf kayıt servisi yokken minimal eşdeğeri:
// her `citation` düğümü için sunucu `raw`'ı KENDİSİ yeniden ayrıştırır (istemci ayrıştırmasına
// güvenilmez), `message_citations` satırını `INSERT … ON CONFLICT (id) DO NOTHING` ile açar; `raw`
// değişince kanonik anahtar farkı satırı `pending`e döndürür (025 §3.3). Doğrulama (`citation.verify`)
// commit SONRASI kuyruğa yalnız kimliklerle alınır; algoritma P13'tedir. İçerik loglanmaz.
import type { TenantTx } from '@eda/db';
import { extractAll } from '@eda/legal/kunye';
import { tr_fold } from '@eda/legal/text';
import {
  type DocCitationRow,
  getCitationsOfDocument,
  insertCitationIfAbsent,
  resetCitation,
} from '../../repositories/documents/citations.ts';
import type { CitationNode } from './rev.ts';

/** Kuyruk bağlantı noktası: P13 `citation.verify` işini kaydedene dek varsayılan işlemsizdir. */
export interface CitationVerifyPort {
  enqueue(job: {
    orgId: string;
    documentId: string;
    /** Yük yalnız kimliktir; metin, künye veya belge içeriği taşımaz. */
    citationIds: string[];
    /** Nesil: yeniden doğrulama `jobId`'yi ayırır (043 §8). */
    gen: number;
  }): Promise<void>;
}

export const NOOP_CITATION_VERIFY: CitationVerifyPort = { enqueue: async () => undefined };

export interface ParsedCitationSummary {
  /** Kanonik anahtar: aynı atıf farklı yazımlarda aynı anahtarı üretir. */
  readonly key: string;
  readonly kind: 'decision_free' | 'article' | 'authority_other' | 'unparsed';
}

/** `raw` metninden kanonik atıf anahtarı; çıkarıcı sonuç vermezse katlanmış metin. */
export function parseCitationRaw(raw: string, today: string): ParsedCitationSummary {
  const found = extractAll(raw, { today }).citations[0];
  if (found === undefined) {
    return { kind: 'unparsed', key: `raw:${tr_fold(raw).replace(/\s+/g, ' ').trim()}` };
  }
  if (found.kind === 'article' && found.article !== null) {
    const a = found.article;
    return {
      kind: 'article',
      key: `a:${a.lawNo ?? a.abbr ?? ''}:${a.articles.map((x) => x.key).join(',')}`,
    };
  }
  const k = found.kunye;
  if (found.kind === 'decision_free' && k !== null) {
    return {
      kind: 'decision_free',
      key: `d:${k.courtClass}:${k.chamberCode ?? ''}:${k.esas?.canon ?? ''}:${k.karar?.canon ?? ''}:${k.date ?? ''}`,
    };
  }
  return { kind: found.kind, key: `o:${tr_fold(raw).replace(/\s+/g, ' ').trim()}` };
}

export interface RegisterResult {
  /** Bu yazımda açılan veya sıfırlanan atıflar (yanıta girer). */
  readonly changed: DocCitationRow[];
}

export async function registerDocumentCitations(
  tx: TenantTx,
  deps: {
    orgId: string;
    documentId: string;
    today: string;
    verify: CitationVerifyPort;
    gen: number;
  },
  nodes: readonly CitationNode[],
): Promise<RegisterResult> {
  // Aynı kimlik birden çok düğümde geçerse ilk düğüm esastır.
  const unique = new Map<string, CitationNode>();
  for (const n of nodes) if (!unique.has(n.citationId)) unique.set(n.citationId, n);
  if (unique.size === 0) return { changed: [] };

  const existing = new Map(
    (await getCitationsOfDocument(tx, deps.orgId, deps.documentId, [...unique.keys()])).map((r) => [
      r.id,
      r,
    ]),
  );
  const changed: DocCitationRow[] = [];
  for (const node of unique.values()) {
    const parsed = parseCitationRaw(node.raw, deps.today);
    const payload = { id: node.citationId, blockId: node.blockId, raw: node.raw, parsed };
    const prior = existing.get(node.citationId);
    if (prior === undefined) {
      const row = await insertCitationIfAbsent(tx, deps.orgId, deps.documentId, payload);
      if (row !== null) changed.push(row);
    } else if (parseCitationRaw(prior.raw, deps.today).key !== parsed.key) {
      const row = await resetCitation(tx, deps.orgId, deps.documentId, payload);
      if (row !== null) changed.push(row);
    }
  }
  if (changed.length > 0) {
    const ids = changed.map((c) => c.id);
    tx.afterCommit(() =>
      deps.verify.enqueue({
        orgId: deps.orgId,
        documentId: deps.documentId,
        citationIds: ids,
        gen: deps.gen,
      }),
    );
  }
  return { changed };
}
