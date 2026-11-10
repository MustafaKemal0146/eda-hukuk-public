// search_legislation ve get_legislation_article (021 §4.5-§4.6). : yerel mevzuat korpusu (P15)
// gelene dek arama canlı yargi-mcp `search_legislation_live` ile yapılır.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { scopeAllowsLegislation } from '@eda/contracts/scope';
import type { GetLegislationArticleInput, SearchLegislationInput } from '@eda/contracts/tools';
import {
  articleHeadingText,
  inferLawNosFromQuery,
  lawDisplay,
  parseArticleSpan,
} from '@eda/legal/kunye';
import { fetchedAtNow, rememberQuoteText, SourceError, type ToolContext } from '../context.ts';
import {
  canonicalArticleNo,
  isoToTr,
  lawArticleTitle,
  lawHitKey,
  lawShortKunye,
  lawSourceKey,
} from '../kunye.ts';
import { TOOL_MESSAGES } from '../messages.ts';
import { EXCERPT_MAX_CHARS, truncateToTokens, wrapSource } from '../serialize.ts';
import type { ToolOutcome } from './types.ts';

function sourceError(e: unknown): ToolOutcome {
  if (e instanceof SourceError) {
    if (e.code === 'SOURCE_DOCUMENT_NOT_FOUND')
      return { text: TOOL_MESSAGES.articleNotFound, isError: false };
    if (e.code === 'SOURCE_BUSY' || e.code === 'SOURCE_RATE_LIMITED')
      return { text: TOOL_MESSAGES.busy, isError: false, notice: 'source_busy' };
    return {
      text: 'Not: Mevzuat kaynağına şu an ulaşılamıyor. Bu, maddenin bulunmadığı anlamına gelmez.',
      isError: false,
      notice: 'source_unavailable',
    };
  }
  throw e;
}

export async function searchLegislation(
  ctx: ToolContext,
  input: SearchLegislationInput,
  _callId: string,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (!scopeAllowsLegislation(ctx.scope)) {
    return { text: TOOL_MESSAGES.outOfScopeLegislation, isError: false, detail: 'kapsam dışı' };
  }
  // Token ayıklama (strip_tokens) maskeleme adaptöründe yapılır; burada ikinci dönüşüm yok (026 §9.6).
  const query = input.query;
  let res: Awaited<ReturnType<ToolContext['backend']['searchLegislation']>>;
  try {
    res = await ctx.backend.searchLegislation({ query, lawNo: input.law_no }, signal);
  } catch (e) {
    return sourceError(e);
  }
  // Kanun numarasız ve sonuçsuz arama kanun adında arar (#12): konu sözcüklerinden en olası kanun(lar)
  // çıkarılıp arama o kanun içinde yinelenir; sonuç "tahmini eşleme" notuyla verilir.
  let inferredFrom: string | null = null;
  if (res.results.length === 0 && input.law_no === null) {
    for (const lawNo of inferLawNosFromQuery(query)) {
      try {
        const retry = await ctx.backend.searchLegislation({ query, lawNo }, signal);
        if (retry.results.length > 0) {
          res = retry;
          inferredFrom = lawNo;
          break;
        }
      } catch (e) {
        return sourceError(e);
      }
    }
  }
  const hits = res.results.slice(0, CONFIG_DEFAULTS['tools.legislationMaxResults']);
  if (hits.length === 0)
    return { text: TOOL_MESSAGES.noLegislation, isError: false, detail: '0 madde' };
  const blocks = hits.map((h, i) => {
    const key = lawHitKey(h);
    const articleNo = h.article_no === null ? null : canonicalArticleNo(h.article_no);
    const rec = ctx.refs.allocate(key, (ref) => ({
      ref,
      kind: 'legislation',
      sourceKey: key,
      sourceId: key,
      shortKunye: lawShortKunye(h.law_no, h.law_name, articleNo),
      title: h.title,
      portal: 'mevzuat',
      url: h.url,
      retrievedAt: h.retrieved_at,
      fetchedAt: fetchedAtNow(ctx),
      relevance: i < 2 ? 'high' : 'medium',
      law: { lawNo: h.law_no, lawName: h.law_name, articleNo },
    }));
    ctx.turnRefs.add(rec.ref);
    const amended = h.last_amended_at ? ` | Son değişiklik: ${isoToTr(h.last_amended_at)}` : '';
    rememberQuoteText(ctx, rec.ref, h.snippet ?? h.title, false);
    return wrapSource(
      rec.ref,
      'mevzuat',
      `${h.law_no} sayılı ${h.law_name}${amended}`,
      h.snippet ?? h.title,
    );
  });
  ctx.emit({ type: 'sources', turnRefs: [...ctx.turnRefs] });
  const note = inferredFrom
    ? `\nNot: Kanun numarası verilmediği ve doğrudan sonuç bulunamadığı için konuya göre en olası kanun olan ${lawDisplay(inferredFrom)} (${inferredFrom} sayılı) içinde arandı; bu tahmini bir eşlemedir, kanunun doğruluğunu kontrol edin.`
    : '';
  return { text: `${blocks.join('\n')}${note}`, isError: false, detail: `${hits.length} sonuç` };
}

export async function getLegislationArticle(
  ctx: ToolContext,
  input: GetLegislationArticleInput,
  callId: string,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  if (!scopeAllowsLegislation(ctx.scope)) {
    return { text: TOOL_MESSAGES.outOfScopeLegislation, isError: false, detail: 'kapsam dışı' };
  }
  let lawNo = input.law_no;
  let articleNo = input.article_no;
  if (input.ref !== null) {
    const rec = ctx.refs.byRef(input.ref);
    if (!rec) return { text: TOOL_MESSAGES.unknownRef(input.ref), isError: true };
    if (rec.kind !== 'legislation' || !rec.law) {
      return { text: TOOL_MESSAGES.wrongKindDecision(input.ref), isError: true };
    }
    lawNo = rec.law.lawNo;
    articleNo = rec.law.articleNo ?? articleNo;
  }
  if (!lawNo || !articleNo)
    return { text: 'Hata: ref veya law_no + article_no verilmeli.', isError: true };
  // 034 §9.3 anahtarı (G1, E3, M18, 352/A); "Geçici 1", "geçici 1-5", "344 - 346" girdileri çevrilir.
  // Çözülemeyen girdi olduğu gibi kaynağa gider (kaynak "bulunamadı" der).
  const span = parseArticleSpan(articleNo);
  const from = span?.from ?? articleNo.trim();
  const to = span?.to ?? null;
  articleNo = canonicalArticleNo(articleNo);
  ctx.emit({
    type: 'pipeline',
    data: {
      stage: 'tool',
      status: 'progress',
      label: 'Madde metni getiriliyor',
      toolName: 'get_legislation_article',
      callId,
      detail: lawShortKunye(lawNo, '', articleNo),
    },
  });
  if (ctx.budget.liveFetches <= 0) {
    return { text: 'Not: Bu tur için getirme hakkı kullanıldı.', isError: false };
  }
  ctx.budget.liveFetches -= 1;
  let doc: Awaited<ReturnType<ToolContext['backend']['getLegislationArticles']>>;
  try {
    doc = await ctx.backend.getLegislationArticles(
      { lawNo, articleNo: from, articleTo: to },
      signal,
    );
  } catch (e) {
    return sourceError(e);
  }
  if (doc.articles.length === 0) return { text: TOOL_MESSAGES.articleNotFound, isError: false };
  const key = lawSourceKey(doc.law_no, articleNo);
  const rec = ctx.refs.allocate(key, (ref) => ({
    ref,
    kind: 'legislation',
    sourceKey: key,
    sourceId: key,
    shortKunye: lawShortKunye(doc.law_no, doc.law_name, articleNo),
    title: lawArticleTitle(doc.law_no, doc.law_name, articleNo),
    portal: 'mevzuat',
    url: doc.url,
    retrievedAt: doc.retrieved_at,
    fetchedAt: fetchedAtNow(ctx),
    relevance: 'high',
    law: { lawNo: doc.law_no, lawName: doc.law_name, articleNo },
  }));
  ctx.turnRefs.add(rec.ref);
  const body = doc.articles
    .map(
      (a) =>
        `${articleHeadingText(a.article_no)}${a.heading ? ` — ${a.heading}` : ''}${a.repealed ? ' (mülga)' : ''}\n${a.markdown}`,
    )
    .join('\n\n');
  // Önizleme vurgusu (#58) yalnız modelin okuduğu metinden hesaplanır; emit'ten ÖNCE yazılır.
  rec.excerpt = body.slice(0, EXCERPT_MAX_CHARS);
  // Getirilen maddelerin tam metni: alıntı denetiminde kaynak metnin tamamı sayılır.
  rememberQuoteText(ctx, rec.ref, body, true);
  ctx.emit({ type: 'sources', turnRefs: [...ctx.turnRefs] });
  const asOf = input.as_of ? '\nNot: Geçmiş sürüm henüz yok; güncel metin gösteriliyor.' : '';
  // Getirilen maddelerin son değişiklik tarihi (madde notlarından; yoksa yazılmaz).
  const amended = doc.last_amended_at ? ` | Son değişiklik: ${isoToTr(doc.last_amended_at)}` : '';
  const header = `${doc.law_no} sayılı ${doc.law_name}${amended} | Canlı: Mevzuat (${isoToTr(doc.retrieved_at)})`;
  return {
    text: `${wrapSource(rec.ref, 'mevzuat', header, truncateToTokens(body, CONFIG_DEFAULTS['tools.fetchMaxTokens'], '…[kısaltıldı]'))}${asOf}`,
    isError: false,
    detail: rec.shortKunye,
  };
}
