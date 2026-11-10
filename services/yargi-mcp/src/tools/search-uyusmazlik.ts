// search_decisions / uyusmazlik (021 §5.7.3). Portal yalnız ilk sonuç sayfasını form yanıtında
// verir (sayfa geçişi form geri gönderimidir): `page > 1` portala gitmeden boş + `pagination_unsupported`.
// Tarih süzgeci portalda yok → dönen sayfada süzülür (`date_filter_partial`). Esas/karar no portalın
// numara kapsamıyla aranır, sonuç tam eşitlikle süzülür (`esas_postfiltered`). : portalın tam
// metin araması 23–27 sn sürüyor; bu kaynakta `sources.uyusmazlik.timeoutSearchMs` (35 sn) geçerlidir.
import type {
  McpSearchDecisionsArgs,
  McpSearchDecisionsResult,
  NormalizedDecisionValue,
} from '@eda/contracts/mcp';
import { canonKey } from '../resilience/cache.ts';
import { isoDay } from '../sources/dates.ts';
import { SourceError, validationFailed } from '../sources/errors.ts';
import {
  type UyusmazlikScope,
  uyusmazlikFormTokens,
  uyusmazlikSearch,
} from '../sources/uyusmazlik/client.ts';
import { normalizeUyusmazlikRow } from '../sources/uyusmazlik/normalize.ts';
import { type Cached, cachedFetch } from './cached.ts';
import { type CallCtx, FORM_TOKEN_TTL_MS, HOUR_MS, type ToolDeps } from './context.ts';
import type { SearchPage } from './search-decisions.ts';

type Warning = McpSearchDecisionsResult['warnings'][number];

export type UyusmazlikPlan = { text: string; scope: UyusmazlikScope; warnings: Warning[] };

/** Yalnız istek kurar; portala gitmez (birim testleri için dışa açık). */
export function planUyusmazlikSearch(args: McpSearchDecisionsArgs): UyusmazlikPlan {
  if (args.court_types?.some((c) => c !== 'uyusmazlik')) {
    throw validationFailed('invalid_arguments', 'uyusmazlik');
  }
  if (args.date_from && args.date_to && args.date_from > args.date_to) {
    throw validationFailed('invalid_arguments', 'uyusmazlik');
  }
  const warnings: Warning[] = [];
  if (args.chamber !== null) warnings.push('chamber_ignored');
  if (args.date_from !== null || args.date_to !== null) warnings.push('date_filter_partial');
  if (args.esas_no !== null || args.karar_no !== null) warnings.push('esas_postfiltered');
  if (args.esas_no !== null) return { text: args.esas_no, scope: 'EsasNo', warnings };
  if (args.karar_no !== null) return { text: args.karar_no, scope: 'KararNo', warnings };
  return { text: args.query.normalize('NFC').trim(), scope: 'All', warnings };
}

const TOKENS_KEY = 'uyusmazlik:form';

export async function searchUyusmazlik(
  deps: ToolDeps,
  args: McpSearchDecisionsArgs,
  ctx: CallCtx,
): Promise<Cached<SearchPage>> {
  const plan = planUyusmazlikSearch(args);
  if (args.page > 1) {
    return {
      value: {
        total: null,
        has_more: null,
        results: [],
        warnings: [...plan.warnings, 'pagination_unsupported'],
      },
      cached: false,
      staleAsOf: null,
    };
  }
  const key = canonKey({
    v: 1,
    op: 'search_decisions',
    source: 'uyusmazlik',
    scope: ctx.cacheScope === 'org' ? ctx.org : 'shared',
    q: plan.text,
    search_scope: plan.scope,
    esas: args.esas_no,
    karar: args.karar_no,
    from: args.date_from,
    to: args.date_to,
    page_size: args.page_size,
  });
  return cachedFetch<SearchPage>(
    deps,
    'uyusmazlik',
    key,
    deps.cfg.searchTtlHours * HOUR_MS,
    async () => {
      let tokens = deps.formTokens.get(TOKENS_KEY, deps.now())?.value;
      if (!tokens) {
        tokens = await uyusmazlikFormTokens(deps.gateway, ctx.priority);
        deps.formTokens.set(TOKENS_KEY, tokens, deps.now(), FORM_TOKEN_TTL_MS, FORM_TOKEN_TTL_MS);
      }
      let page: Awaited<ReturnType<typeof uyusmazlikSearch>>;
      try {
        page = await uyusmazlikSearch(deps.gateway, tokens, plan.text, plan.scope, ctx.priority);
      } catch (err) {
        // Form durumu bayatlamış olabilir: bir sonraki çağrı yeni gizli alanlarla başlar.
        if (
          err instanceof SourceError &&
          (err.reason === 'parse_error' || err.reason === 'upstream_5xx')
        ) {
          deps.formTokens.remove(TOKENS_KEY);
        }
        throw err;
      }
      const today = isoDay(deps.now());
      let results = page.rows
        .map((row) => normalizeUyusmazlikRow(row, today))
        .filter((r): r is NormalizedDecisionValue => r !== null);
      if (args.esas_no !== null) results = results.filter((r) => r.esas_no === args.esas_no);
      if (args.karar_no !== null) results = results.filter((r) => r.karar_no === args.karar_no);
      if (args.date_from !== null || args.date_to !== null) {
        const from = args.date_from ?? '0000-00-00';
        const to = args.date_to ?? '9999-99-99';
        results = results.filter(
          (r) => r.decision_date !== null && r.decision_date >= from && r.decision_date <= to,
        );
      }
      const filtered = results.length;
      results = results.slice(0, args.page_size);
      const total = page.total;
      return {
        total,
        has_more: total === null ? filtered > results.length : total > results.length,
        results,
        warnings: [...plan.warnings],
      };
    },
  );
}
