// Mevzuat iş kuralları (P15.8–P15.9; 041 §5.3; 053-05 §9). Korpus (P15 anlık görüntü) yokken her uç
// canlı kaynaktan (`get_legislation_live`, `search_legislation_live`) `origin: 'live'` döner.
// Kaynağa ulaşılamaması "bulunamadı" sayılmaz (KK-053-05-15). Sorgu kalıcı saklanmaz.

import {
  type ArticleDtoValue,
  LAW_TYPE_TO_MCP,
  type LawDtoValue,
  type LegislationHitDtoValue,
  type LegislationSearchRequestValue,
  type LegislationSearchResultsDtoValue,
  MCP_TO_LAW_TYPE,
  sourceToUrlArticleNo,
  urlToSourceArticleNo,
} from '@eda/contracts/api';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { LawType, McpLawType } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import type { LegislationHitValue, McpGetLegislationLiveResult } from '@eda/contracts/mcp';
import { inferLawNosFromQuery, lawByNo, parseArticleKey } from '@eda/legal/kunye';
import { liveErrorToAppError } from '../sources/errors.ts';
import { type LiveSource, LiveSourceError } from '../sources/live-source.ts';

const MAX_RESULTS = CONFIG_DEFAULTS['tools.legislationMaxResults'];
/** MCP `LawNo` deseni (021 §5.4) 5 haneyle sınırlı; daha uzun numara canlı kaynakta aranamaz. */
const MCP_LAW_NO = /^\d{1,5}$/;
const MCP_QUERY_MAX = 200;

function lawTypeOf(lawNo: string, mcp: McpLawType): LawType | null {
  const t = MCP_TO_LAW_TYPE[mcp];
  if (t === 'law' && lawByNo(lawNo)?.lawType === 'anayasa') return 'constitution';
  return t;
}

/** Görüntü kısaltması (081 §6 sözlüğü); sözlükte yoksa `null` (istemci "6098 s. K." yazar). */
function shortNameOf(lawNo: string): string | null {
  return lawByNo(lawNo)?.display ?? null;
}

/**
 * Kaynak Markdown'ı → düz metin (053-05 §2 ilke 8: HTML/markdown görüntü yok). Yalnız biçim işaretleri
 * atılır; metin yeniden yazılmaz.
 */
export function plainText(markdown: string): string {
  return markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, '')
        .replace(/\*\*|__/g, '')
        .replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1')
        .trimEnd(),
    )
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function rethrow(err: unknown, notFound: 'law' | 'article'): never {
  if (err instanceof LiveSourceError) throw liveErrorToAppError(err, notFound);
  throw err;
}

function articleTitleOf(hit: LegislationHitValue): string | null {
  if (hit.article_no === null) return null;
  const sep = hit.title.indexOf(' — ');
  return sep >= 0 ? hit.title.slice(sep + 3).trim() || null : null;
}

export function toLegislationHit(hit: LegislationHitValue): LegislationHitDtoValue | null {
  const lawType = lawTypeOf(hit.law_no, hit.law_type);
  if (lawType === null) return null;
  const articleNo = hit.article_no === null ? null : sourceToUrlArticleNo(hit.article_no);
  return {
    lawNo: hit.law_no,
    lawType,
    lawTitle: hit.law_name,
    shortName: shortNameOf(hit.law_no),
    articleNo,
    articleTitle: articleNo === null ? null : articleTitleOf(hit),
    snippet: hit.snippet,
    highlights: [],
    // Canlı sonuç mülga maddeleri dışarıda bırakır (yargi-mcp sıralayıcısı); mülga bilgisi taşımaz.
    status: 'in_force',
    matchKind: 'hybrid',
    relevance: null,
    origin: 'live',
  };
}

function toLawDto(r: McpGetLegislationLiveResult): LawDtoValue {
  return {
    lawNo: r.law_no,
    lawType: lawTypeOf(r.law_no, r.law_type) ?? 'law',
    title: r.law_name,
    shortName: shortNameOf(r.law_no),
    officialGazetteDate: null,
    officialGazetteNo: null,
    acceptedDate: null,
    lastAmendedDate: r.last_amended_at,
    // Kanun düzeyinde mülga çıkarımı yapılmaz (P15 K9).
    status: 'in_force',
    sourceUrl: r.url,
    articleCount: 0,
    lastSnapshotDate: null,
    warnings: [],
    origin: 'live',
    retrievedAt: r.retrieved_at,
  };
}

export type LegislationServiceDeps = { source: LiveSource };

export function createLegislationService(deps: LegislationServiceDeps) {
  return {
    async search(
      req: LegislationSearchRequestValue,
      signal: AbortSignal,
    ): Promise<LegislationSearchResultsDtoValue> {
      if (req.lawNo !== null && !MCP_LAW_NO.test(req.lawNo)) {
        return { items: [], empty: true, degraded: false };
      }
      let results: LegislationHitValue[];
      try {
        const run = (lawNo: string | null) =>
          deps.source.searchLegislation(
            {
              query: req.query.slice(0, MCP_QUERY_MAX),
              law_no: lawNo,
              page: 1,
              page_size: MAX_RESULTS,
            },
            signal,
          );
        results = (await run(req.lawNo)).results;
        // Kanun filtresiz arama kanun adında arar (#12): boşsa konudan çıkarılan kanunda yinele.
        if (results.length === 0 && req.lawNo === null) {
          for (const lawNo of inferLawNosFromQuery(req.query)) {
            const retry = (await run(lawNo)).results;
            if (retry.length > 0) {
              results = retry;
              break;
            }
          }
        }
      } catch (err) {
        // Arama "yok" demez: kaynak hatası olduğu gibi (SOURCE_*) döner.
        rethrow(err, 'law');
      }
      const items = results
        .flatMap((h) => toLegislationHit(h) ?? [])
        .filter((h) => req.lawType === null || h.lawType === req.lawType)
        .slice(0, MAX_RESULTS);
      return { items, empty: items.length === 0, degraded: false };
    },

    /** Kanun üst verisi: varlık madde 1 penceresiyle doğrulanır; madde dizini hazır değil (P15). */
    async getLaw(lawNo: string, type: LawType | null, signal: AbortSignal): Promise<LawDtoValue> {
      if (!MCP_LAW_NO.test(lawNo)) {
        throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'law' });
      }
      try {
        const r = await deps.source.getLegislation(
          {
            law_no: lawNo,
            law_type: type === null ? null : LAW_TYPE_TO_MCP[type],
            article_no: '1',
            article_to: null,
          },
          signal,
        );
        return toLawDto(r);
      } catch (err) {
        rethrow(err, 'law');
      }
    },

    /**
     * Madde metni + komşu maddeler tek çağrıda: `[n-1, n+1]` aralığı aynı türde istenir (yargi-mcp
     * 034 §9.3 anahtarı: "351"-"353", "G4"-"G6"; harfli madde sayı parçasıyla girer) ve kaynak sırasındaki
     * önceki/sonraki madde buradan çıkarılır. Komşu yalnız aynı türdendir.
     */
    async getArticle(
      lawNo: string,
      urlArticleNo: string,
      type: LawType | null,
      asOf: string | null,
      signal: AbortSignal,
    ): Promise<ArticleDtoValue> {
      const key = urlToSourceArticleNo(urlArticleNo);
      if (!MCP_LAW_NO.test(lawNo) || key === null) {
        throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'article' });
      }
      const parts = parseArticleKey(key);
      const numeric = parts?.number ?? null;
      const prefix = parts?.prefix ?? '';
      const lawType = type === null ? null : LAW_TYPE_TO_MCP[type];
      const fetchRange = (from: string, to: string | null) =>
        deps.source.getLegislation(
          { law_no: lawNo, law_type: lawType, article_no: from, article_to: to },
          signal,
        );
      let r: McpGetLegislationLiveResult;
      try {
        r =
          numeric === null
            ? await fetchRange(key, null)
            : await fetchRange(`${prefix}${Math.max(1, numeric - 1)}`, `${prefix}${numeric + 1}`);
        if (!r.articles.some((a) => a.article_no === key)) {
          // Aralık 5 maddeyle kesildiyse istenen madde tek başına istenir.
          if (numeric !== null && r.warnings.includes('article_range_truncated')) {
            r = await fetchRange(key, null);
          }
        }
      } catch (err) {
        rethrow(err, 'article');
      }
      const idx = r.articles.findIndex((a) => a.article_no === key);
      const art = r.articles[idx];
      if (!art) throw new AppError('VALIDATION_RESOURCE_NOT_FOUND', { reason: 'article' });
      const neighbour = (i: number): string | null => {
        const a = numeric === null ? undefined : r.articles[i];
        return a ? sourceToUrlArticleNo(a.article_no) : null;
      };
      return {
        lawNo: r.law_no,
        lawType: lawTypeOf(r.law_no, r.law_type) ?? 'law',
        lawTitle: r.law_name,
        shortName: shortNameOf(r.law_no),
        articleNo: sourceToUrlArticleNo(art.article_no) ?? urlArticleNo,
        title: art.heading,
        text: plainText(art.markdown),
        status: art.repealed ? 'repealed' : 'in_force',
        amendedNote: null,
        lastAmendedDate: r.last_amended_at,
        // Canlı kaynak yalnız güncel metni verir: tarihli istek doğrulanamaz (053-05 §8).
        asOf,
        asOfUnverified: asOf !== null,
        origin: 'live',
        retrievedAt: r.retrieved_at,
        prevArticleNo: neighbour(idx - 1),
        nextArticleNo: neighbour(idx + 1),
        sourceUrl: r.url,
        warnings: [],
      };
    },
  };
}

export type LegislationService = ReturnType<typeof createLegislationService>;
