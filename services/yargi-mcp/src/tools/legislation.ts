// search_legislation_live / get_legislation_live (021 §5.4, §5.7.4). Canlı yol Bedesten mevzuat uçları:
// arama `mevzuatAdi` (ad araması) veya `mevzuatNo`; madde metni konsolide belgenin bölünmesiyle.
// AS-P11-14: `query` yalnız mevzuat adında aranır (`phrase` tam metin araması alakasız yönetmelikleri
// öne çıkardı, 2026-10-10 denemesi); `law_no` verilirse yalnız numara süzgeci uygulanır.
import type {
  LegislationHitValue,
  McpGetLegislationLiveArgs,
  McpGetLegislationLiveResult,
  McpSearchLegislationLiveArgs,
  McpSearchLegislationLiveResult,
} from '@eda/contracts/mcp';
import { formatArticleRef } from '@eda/legal/kunye';
import { containsPii } from '../pii-guard.ts';
import { canonKey } from '../resilience/cache.ts';
import { isoDay } from '../sources/dates.ts';
import { SourceError } from '../sources/errors.ts';
import { latestAmendedAt, selectArticles, splitLawArticles } from '../sources/mevzuat/articles.ts';
import {
  type MevzuatItemValue,
  type MevzuatSearchBody,
  mevzuatGetDocument,
  mevzuatSearch,
} from '../sources/mevzuat/client.ts';
import {
  LAW_TYPE_TO_TUR,
  lawTypeOf,
  legislationHit,
  mevzuatRef,
  mevzuatUrl,
} from '../sources/mevzuat/normalize.ts';
import { decodeHtml, htmlToMarkdown } from '../transform/convert.ts';
import { lawNoFromQuery, rankArticles } from '../transform/query.ts';
import { cachedFetch } from './cached.ts';
import { type CallCtx, HOUR_MS, type LawDoc, type ToolDeps } from './context.ts';

/** "TÜRK BORÇLAR KANUNU m. 352", "… geçici m. 1" (081 §4.3 gösterimi, 034 §9.3 anahtarı). */
const articleRefText = (lawNo: string, lawName: string, key: string): string =>
  formatArticleRef({ lawNo, lawShort: lawName, articles: [{ key, paragraph: null, sub: null }] });

/** 021 §4.12 `tools.articleRangeMax` (5). */
const ARTICLE_RANGE_MAX = 5;

function assertEnabled(deps: ToolDeps): void {
  if (!deps.enabled.has('mevzuat')) {
    throw new SourceError('SOURCE_NOT_IN_COVERAGE', 'source_disabled', { source: 'mevzuat' });
  }
}

type HitsPage = { total: number | null; has_more: boolean | null; results: LegislationHitValue[] };

export async function searchLegislationLive(
  deps: ToolDeps,
  args: McpSearchLegislationLiveArgs,
  ctx: CallCtx,
): Promise<McpSearchLegislationLiveResult> {
  assertEnabled(deps);
  if (containsPii(args.query))
    throw new SourceError('SOURCE_PII_BLOCKED', null, { source: 'mevzuat' });
  // Madde düzeyinde arama: kanun numarası verildiyse veya sorgu bilinen bir kanunu
  // adlandırıyorsa, konsolide metnin maddeleri sorgu terimleriyle puanlanır.
  const lawNo = args.law_no ?? lawNoFromQuery(args.query);
  if (lawNo !== null) {
    const articleHits = await searchArticles(deps, lawNo, args, ctx);
    if (articleHits) return articleHits;
  }
  const body: MevzuatSearchBody = {
    pageSize: args.page_size,
    pageNumber: args.page,
    ...(args.law_no !== null
      ? { mevzuatNo: args.law_no }
      : { mevzuatAdi: args.query.normalize('NFC').trim() }),
  };
  const key = canonKey({
    v: 1,
    op: 'search_legislation_live',
    source: 'mevzuat',
    scope: ctx.cacheScope === 'org' ? ctx.org : 'shared',
    body,
  });
  const res = await cachedFetch<HitsPage>(
    deps,
    'mevzuat',
    key,
    deps.cfg.legislationTtlHours * HOUR_MS,
    async () => {
      const raw = await mevzuatSearch(deps.gateway, body, ctx.priority);
      const today = isoDay(deps.now());
      const start = (args.page - 1) * args.page_size;
      return {
        total: raw.total,
        has_more: raw.total === null ? null : start + raw.items.length < raw.total,
        results: raw.items.slice(0, args.page_size).map((it) => legislationHit(it, today)),
      };
    },
  );
  return {
    page: args.page,
    page_size: args.page_size,
    ...res.value,
    status: res.staleAsOf ? 'stale' : 'ok',
    cached: res.cached,
    stale_as_of: res.staleAsOf,
    warnings: [],
  };
}

async function searchArticles(
  deps: ToolDeps,
  lawNo: string,
  args: McpSearchLegislationLiveArgs,
  ctx: CallCtx,
): Promise<McpSearchLegislationLiveResult | null> {
  let loaded: Awaited<ReturnType<typeof loadLaw>>;
  try {
    loaded = await loadLaw(deps, lawNo, null, ctx);
  } catch (e) {
    if (e instanceof SourceError && e.code === 'SOURCE_DOCUMENT_NOT_FOUND') return null;
    throw e;
  }
  const ranked = rankArticles(loaded.doc.articles, args.query, args.page_size);
  if (ranked.length === 0) return null;
  const today = isoDay(deps.now());
  const base = legislationHit(loaded.law, today);
  return {
    page: 1,
    page_size: args.page_size,
    total: ranked.length,
    has_more: false,
    results: ranked.map((r) => ({
      ...base,
      article_no: r.item.articleNo,
      title: `${articleRefText(base.law_no, base.law_name, r.item.articleNo)}${r.item.heading ? ` — ${r.item.heading}` : ''}`,
      snippet: r.snippet.slice(0, 300),
    })),
    status: 'ok',
    cached: loaded.cached,
    stale_as_of: null,
    warnings: [],
  };
}

function pickLaw(
  items: MevzuatItemValue[],
  args: McpGetLegislationLiveArgs,
): MevzuatItemValue | null {
  const type = args.law_type ?? 'kanun';
  const matches = items.filter(
    (it) => String(it.mevzuatNo) === args.law_no && lawTypeOf(it.mevzuatTur.name) === type,
  );
  // Güncel tertip (5) önce; yoksa en yüksek tertip.
  matches.sort(
    (a, b) =>
      (b.mevzuatTertip === 5 ? 1 : 0) - (a.mevzuatTertip === 5 ? 1 : 0) ||
      b.mevzuatTertip - a.mevzuatTertip,
  );
  return matches[0] ?? null;
}

/** Kanunu numarasıyla bulur ve konsolide metni maddelere bölünmüş olarak getirir (belge tamponu). */
async function loadLaw(
  deps: ToolDeps,
  lawNo: string,
  lawType: McpGetLegislationLiveArgs['law_type'],
  ctx: CallCtx,
): Promise<{ law: MevzuatItemValue; doc: LawDoc; cached: boolean }> {
  const args = { law_no: lawNo, law_type: lawType } as McpGetLegislationLiveArgs;
  const type = lawType ?? 'kanun';
  const body: MevzuatSearchBody = {
    pageSize: 10,
    pageNumber: 1,
    mevzuatNo: lawNo,
    ...(type !== 'diger' ? { mevzuatTurList: [LAW_TYPE_TO_TUR[type]] } : {}),
  };
  const key = canonKey({ v: 1, op: 'mevzuat_lookup', source: 'mevzuat', scope: 'shared', body });
  const found = await cachedFetch<MevzuatItemValue[]>(
    deps,
    'mevzuat',
    key,
    deps.cfg.legislationTtlHours * HOUR_MS,
    async () => (await mevzuatSearch(deps.gateway, body, ctx.priority)).items,
  );
  const law = pickLaw(found.value, args);
  if (!law) throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source: 'mevzuat' });

  const docKey = `mevzuat:${law.mevzuatId}`;
  let cached = true;
  let doc = deps.docBuffer.get(docKey, deps.now())?.value;
  if (doc?.kind !== 'law') {
    cached = false;
    doc = await deps.flights.run(`doc:${docKey}`, async () => {
      const bytes = await mevzuatGetDocument(deps.gateway, law.mevzuatId, ctx.priority);
      const articles = splitLawArticles(htmlToMarkdown(decodeHtml(bytes)));
      if (articles.length === 0) throw deps.gateway.reportParseError('mevzuat');
      const value: LawDoc = { kind: 'law', articles };
      const size = articles.reduce((n, a) => n + a.markdown.length * 2, 0);
      const ttl = deps.cfg.docLruTtlSec * 1000;
      deps.docBuffer.set(docKey, value, deps.now(), ttl, ttl, size);
      return value;
    });
  } else {
    deps.gateway.metricsOf('mevzuat').record(deps.now(), 'cache_hit');
  }
  return { law, doc, cached: cached && found.cached };
}

export async function getLegislationLive(
  deps: ToolDeps,
  args: McpGetLegislationLiveArgs,
  ctx: CallCtx,
): Promise<McpGetLegislationLiveResult> {
  assertEnabled(deps);
  const { law, doc, cached } = await loadLaw(deps, args.law_no, args.law_type, ctx);
  const { articles, truncated } = selectArticles(
    doc.articles,
    args.article_no,
    args.article_to,
    ARTICLE_RANGE_MAX,
  );
  if (articles.length === 0)
    throw new SourceError('SOURCE_DOCUMENT_NOT_FOUND', null, { source: 'mevzuat' });
  const out = articles.map((a) => ({
    article_no: a.articleNo,
    heading: a.heading,
    markdown: a.markdown,
    repealed: a.repealed,
  }));
  return {
    law_no: String(law.mevzuatNo),
    law_type: lawTypeOf(law.mevzuatTur.name),
    law_name: law.mevzuatAdi.replace(/\s+/g, ' ').trim(),
    mevzuat_ref: mevzuatRef(law),
    url: mevzuatUrl(law),
    retrieved_at: isoDay(deps.now()),
    // Madde odaklı istekte yürürlük/değişiklik bilgisi: getirilen maddelerin notlarındaki en geç tarih.
    last_amended_at: latestAmendedAt(articles),
    articles: out,
    total_chars: out.reduce((n, a) => n + a.markdown.length, 0),
    cached,
    warnings: truncated ? ['article_range_truncated'] : [],
  };
}
