// Künye Kilidi senkron yolu, dilim sürümü (025 §9.1): yanıttaki [K#] etiketleri sohbette verilmiş
// kaynaklarla eşleştirilir. Kaynaklar resmî portaldan canlı getirildiği için eşleşen etiket `verified`;
// sohbette verilmemiş etiket `not_found` + `not_in_conversation` (dışa aktarımı engeller). Tırnak içi
// alıntısı kaynağın metninde bulunamayan etiket `out_of_context` + `quote_mismatch` olur (025 §6.4;
// engellemez); alıntı denetimi `@eda/ai` `checkCitationQuotes` ile tur sonunda yapılır.
import { randomUUID } from 'node:crypto';
import type { RefStore } from '@eda/ai';
import type { CitationItem } from '@eda/contracts/stream';

export function extractRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/\[(K[1-9]\d*)\]/g)].map((m) => m[1] as string))];
}

export function verifyCitations(
  text: string,
  refs: RefStore,
  quoteMismatched: ReadonlySet<string> = new Set(),
): CitationItem[] {
  return extractRefs(text).map((ref) => {
    const rec = refs.byRef(ref);
    if (!rec) {
      return {
        citationId: randomUUID(),
        ref,
        raw: `[${ref}]`,
        status: 'not_found',
        reason: 'not_in_conversation',
        blocking: 'hard',
      };
    }
    if (quoteMismatched.has(ref)) {
      return {
        citationId: randomUUID(),
        ref,
        raw: rec.shortKunye,
        status: 'out_of_context',
        reason: 'quote_mismatch',
        sourceId: rec.sourceId,
        blocking: 'none',
      };
    }
    return {
      citationId: randomUUID(),
      ref,
      raw: rec.shortKunye,
      status: 'verified',
      sourceId: rec.sourceId,
      blocking: 'none',
    };
  });
}
