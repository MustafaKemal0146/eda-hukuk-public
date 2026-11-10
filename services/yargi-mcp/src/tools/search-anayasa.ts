// search_decisions / anayasa (021 §5.7.2). İki karar türü tek uçta: `court_types` tek türse
// `kararTipi` süzgeci gönderilir, iki tür (veya null) ise süzgeç gönderilmez ve norm/bireysel dışındaki
// türler (siyasi parti, Yüce Divan, yasama dokunulmazlığı) sonuçtan düşer. Esas/karar/başvuru no
// portalda süzgeçtir; sonuç ayrıca tam eşitlikle doğrulanır. Tarih süzgeci iki türde de portaldadır.
import type {
  McpSearchDecisionsArgs,
  McpSearchDecisionsResult,
  NormalizedDecisionValue,
} from '@eda/contracts/mcp';
import { canonKey } from '../resilience/cache.ts';
import { type AymSearchBody, aymSearch } from '../sources/anayasa/client.ts';
import {
  AYM_COURT_TYPES,
  AYM_KINDS,
  type AymCourtType,
  isAymCourtType,
} from '../sources/anayasa/codes.ts';
import { normalizeAymItem } from '../sources/anayasa/normalize.ts';
import { isoDay } from '../sources/dates.ts';
import { validationFailed } from '../sources/errors.ts';
import { type Cached, cachedFetch } from './cached.ts';
import { type CallCtx, DECISION_META_TTL_MS, HOUR_MS, type ToolDeps } from './context.ts';
import type { SearchPage } from './search-decisions.ts';

type Warning = McpSearchDecisionsResult['warnings'][number];

export type AnayasaPlan = {
  courtTypes: AymCourtType[];
  host: string;
  body: AymSearchBody;
  warnings: Warning[];
};

/** Yalnız istek kurar; portala gitmez (birim testleri için dışa açık). */
export function planAnayasaSearch(args: McpSearchDecisionsArgs): AnayasaPlan {
  const requested = args.court_types ?? null;
  if (requested?.some((c) => !isAymCourtType(c))) {
    throw validationFailed('invalid_arguments', 'anayasa');
  }
  const courtTypes = requested
    ? AYM_COURT_TYPES.filter((c) => requested.includes(c))
    : [...AYM_COURT_TYPES];
  if (args.date_from && args.date_to && args.date_from > args.date_to) {
    throw validationFailed('invalid_arguments', 'anayasa');
  }
  const only = courtTypes.length === 1 ? courtTypes[0] : undefined;
  // Bireysel başvuru kararında karar numarası yoktur (künye başvuru numarasıdır).
  if (only === 'aym_bireysel' && args.karar_no !== null) {
    throw validationFailed('invalid_arguments', 'anayasa');
  }
  const warnings: Warning[] = [];
  if (args.chamber !== null) warnings.push('chamber_ignored');
  const byNumber = args.esas_no !== null || args.karar_no !== null;
  const body: AymSearchBody = {
    ...(only ? { kararTipi: AYM_KINDS[only].kararTipi } : {}),
    // Numara verilirse serbest metin gönderilmez (bedesten ile aynı kural, 021 §5.7.1).
    ...(byNumber ? {} : { query: args.query.normalize('NFC').trim() }),
    ...(args.esas_no !== null
      ? only === 'aym_bireysel'
        ? { basvuruNo: args.esas_no }
        : { esasNo: args.esas_no }
      : {}),
    ...(args.karar_no !== null ? { kararNo: args.karar_no } : {}),
    ...(args.date_from ? { kararTarihiStart: args.date_from } : {}),
    ...(args.date_to ? { kararTarihiEnd: args.date_to } : {}),
    page: String(args.page - 1),
    size: String(args.page_size),
  };
  const host = only === 'aym_bireysel' ? AYM_KINDS.aym_bireysel.host : AYM_KINDS.aym_norm.host;
  return { courtTypes, host, body, warnings };
}

export async function searchAnayasa(
  deps: ToolDeps,
  args: McpSearchDecisionsArgs,
  ctx: CallCtx,
): Promise<Cached<SearchPage>> {
  const plan = planAnayasaSearch(args);
  const key = canonKey({
    v: 1,
    op: 'search_decisions',
    source: 'anayasa',
    scope: ctx.cacheScope === 'org' ? ctx.org : 'shared',
    host: plan.host,
    body: plan.body,
  });
  return cachedFetch<SearchPage>(
    deps,
    'anayasa',
    key,
    deps.cfg.searchTtlHours * HOUR_MS,
    async () => {
      const raw = await aymSearch(deps.gateway, plan.host, plan.body, ctx.priority);
      const now = deps.now();
      const today = isoDay(now);
      const warnings = [...plan.warnings];
      let results: NormalizedDecisionValue[] = [];
      for (const item of raw.items) {
        const r = normalizeAymItem(item, today);
        if (!r || !plan.courtTypes.some((c) => c === r.court_type)) continue;
        results.push(r);
        deps.portalRefs.set(
          `anayasa:${r.document_id}`,
          item.id,
          now,
          DECISION_META_TTL_MS,
          DECISION_META_TTL_MS,
        );
      }
      const before = results.length;
      if (args.esas_no !== null) results = results.filter((r) => r.esas_no === args.esas_no);
      if (args.karar_no !== null) results = results.filter((r) => r.karar_no === args.karar_no);
      if (results.length < before) warnings.push('esas_postfiltered');
      if (results.length > args.page_size) {
        results = results.slice(0, args.page_size);
        warnings.push('results_truncated');
      }
      const start = (args.page - 1) * args.page_size;
      return {
        total: raw.total,
        has_more: raw.total === null ? null : start + raw.items.length < raw.total,
        results,
        warnings,
      };
    },
  );
}
