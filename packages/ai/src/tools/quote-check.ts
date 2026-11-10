// Alıntı denetimi (025 §6), sohbet turu sonu: yanıttaki tırnak içi alıntı `[K#]` ile bir kaynağa
// atfedilmişse alıntı o kaynağın sunucuda tutulan metninde aranır. Yanlış alarm üretilmez (fail-safe):
// uyuşmazlık yalnız kaynağın TAM metniyle doğrulanınca bildirilir. Tam metin elde yoksa karar için tek
// bir yeniden getirme denenir (bütçe `citations.maxLivePerMessage`, süre `sources.mcpDocTimeoutMs`);
// başarısızsa alıntı denetlenmemiş sayılır ve atıfın durumu değişmez. Alıntı metni hiçbir yere yazılmaz.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { extractAttributedQuotes, matchQuote } from '@eda/legal/kunye';
import type { QuoteText, RefStore, SourceBackend, SourceRecord } from './context.ts';
import { EXCERPT_MAX_CHARS } from './serialize.ts';

export type QuoteCheckInput = {
  /** Modelin yanıt metni. */
  text: string;
  refs: RefStore;
  /** Bu turda araçlarla getirilen kaynak metinleri (`ToolContext.quoteTexts`). */
  memory: ReadonlyMap<string, readonly QuoteText[]>;
  backend: Pick<SourceBackend, 'getDecision'>;
  /** Tur iptal sinyali; yeniden getirme ayrıca `sources.mcpDocTimeoutMs` ile sınırlıdır. */
  signal: AbortSignal;
};

export type QuoteCheckResult = {
  /** Alıntısı kaynağın tam metninde bulunamayan etiketler. */
  mismatched: Set<string>;
  /** Sayaçlar (yalnız sayı; içerik yok): denetlenen alıntı ve kanıt yetersizliğinden denetlenemeyen. */
  checked: number;
  unchecked: number;
};

type Haystack = { texts: string[]; complete: boolean };

/** Bellekteki metinler + kalıcı kayıttaki özüt (önceki turlarda okunan metin). */
function knownTexts(rec: SourceRecord, memory: readonly QuoteText[]): Haystack {
  const texts = memory.map((m) => m.text);
  let complete = memory.some((m) => m.complete);
  if (rec.excerpt) {
    texts.push(rec.excerpt);
    // Madde özütü kesilmemişse madde metninin tamamıdır; karar özütü her zaman bir bölüm/özettir.
    if (rec.kind === 'legislation' && rec.excerpt.length < EXCERPT_MAX_CHARS) complete = true;
  }
  return { texts, complete };
}

export async function checkCitationQuotes(input: QuoteCheckInput): Promise<QuoteCheckResult> {
  const result: QuoteCheckResult = { mismatched: new Set(), checked: 0, unchecked: 0 };
  const quotes = extractAttributedQuotes(input.text, {
    minChars: CONFIG_DEFAULTS['citations.quoteMinChars'],
    windowChars: CONFIG_DEFAULTS['citations.quoteAttributionWindowChars'],
  });
  if (quotes.length === 0) return result;
  const fragOpts = { fragmentMinChars: CONFIG_DEFAULTS['citations.quoteFragmentMinChars'] };

  // 1. Elde olan metinlerle karşılaştırma.
  const needFull = new Map<string, string[]>();
  for (const q of quotes) {
    const rec = input.refs.byRef(q.ref);
    if (!rec) continue; // Sohbette verilmemiş etiket ayrıca `not_found` olur.
    const hay = knownTexts(rec, input.memory.get(q.ref) ?? []);
    const m = matchQuote(q.quote, hay.texts, fragOpts);
    if (m.status === 'too_short') continue;
    if (m.status === 'matched') {
      result.checked += 1;
      continue;
    }
    if (hay.complete) {
      result.checked += 1;
      result.mismatched.add(q.ref);
      continue;
    }
    if (rec.kind === 'decision' && rec.decision) {
      needFull.set(q.ref, [...(needFull.get(q.ref) ?? []), q.quote]);
    } else {
      result.unchecked += 1;
    }
  }
  if (needFull.size === 0) return result;

  // 2. Tam metin yok: karar başına tek yeniden getirme denemesi (bütçe ve süre sınırlı).
  const budget = CONFIG_DEFAULTS['citations.maxLivePerMessage'];
  const deadline = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(CONFIG_DEFAULTS['sources.mcpDocTimeoutMs']),
  ]);
  const entries = [...needFull.entries()];
  await Promise.all(
    entries.map(async ([ref, refQuotes], i) => {
      const rec = input.refs.byRef(ref);
      const hit = rec?.decision;
      if (!rec || !hit || i >= budget) {
        result.unchecked += refQuotes.length;
        return;
      }
      let full: string | null = null;
      try {
        const doc = await input.backend.getDecision(hit.source, hit.document_id, null, deadline);
        if (doc.text_status === 'ok' && doc.sections.every((s) => s.markdown !== null)) {
          full = doc.sections.map((s) => s.markdown ?? '').join('\n\n');
        }
      } catch {
        // Kaynağa ulaşılamadı / süre doldu: kanıt yok, durum değişmez.
      }
      if (full === null || full.trim() === '') {
        result.unchecked += refQuotes.length;
        return;
      }
      const known = knownTexts(rec, input.memory.get(ref) ?? []).texts;
      for (const quote of refQuotes) {
        result.checked += 1;
        if (matchQuote(quote, [...known, full], fragOpts).status === 'mismatch') {
          result.mismatched.add(ref);
        }
      }
    }),
  );
  return result;
}
