// search_decisions (021 §5.4, §5.7): kaynak başına plan + portal çağrısı; ortak önbellek/tek uçuş.
// bedesten burada; anayasa ve uyusmazlik ayrı modüllerde.
import type {
  McpSearchDecisionsArgs,
  McpSearchDecisionsResult,
  NormalizedDecisionValue,
} from '@eda/contracts/mcp';
import { parseCaseNo } from '@eda/legal/kunye';
import { containsPii } from '../pii-guard.ts';
import { canonKey } from '../resilience/cache.ts';
import { CHAMBER_TO_BIRIM, chamberCourt } from '../sources/bedesten/chambers.ts';
import { type BedestenSearchBody, bedestenSearch } from '../sources/bedesten/client.ts';
import {
  BEDESTEN_COURT_TYPES,
  BEDESTEN_ITEM_TYPES,
  type BedestenCourtType,
  normalizeSearchItem,
} from '../sources/bedesten/normalize.ts';
import { bedestenRange, isoDay } from '../sources/dates.ts';
import { SourceError, validationFailed } from '../sources/errors.ts';
import { type Cached, cachedFetch } from './cached.ts';
import { type CallCtx, DECISION_META_TTL_MS, HOUR_MS, type ToolDeps } from './context.ts';
import { searchAnayasa } from './search-anayasa.ts';
import { searchUyusmazlik } from './search-uyusmazlik.ts';

type Warning = McpSearchDecisionsResult['warnings'][number];

/**
 * Esas/karar numarasını kanonik `YYYY/N` biçimine çevirir ("2022/08302" → "2022/8302"): portaldaki
 * `esasNoYil`/`esasNoSira` alanlarından türeyen normalize değerle eşitlik süzmesi bu biçimle yapılır.
 */
export function canonicalCaseNo(value: string | null): string | null {
  if (value === null) return null;
  return parseCaseNo(value)?.canon ?? value;
}
export type SearchPage = Pick<
  McpSearchDecisionsResult,
  'total' | 'has_more' | 'results' | 'warnings'
>;
type Page = SearchPage;

/** Yalnız künye arama ve süzgeç dönüşümleri; istek atmaz (KK-021-12 için dışa açık). */
export function planBedestenSearch(args: McpSearchDecisionsArgs): {
  body: BedestenSearchBody;
  warnings: Warning[];
  courtTypes: BedestenCourtType[];
} {
  const warnings: Warning[] = [];
  const requested = args.court_types ?? null;
  if (requested?.some((c) => !(c in BEDESTEN_ITEM_TYPES))) {
    throw validationFailed('invalid_arguments', 'bedesten');
  }
  let courtTypes = (requested as BedestenCourtType[] | null) ?? null;
  let birimAdi: string | undefined;
  if (args.chamber !== null) {
    const owner = chamberCourt(args.chamber);
    const name = CHAMBER_TO_BIRIM.get(args.chamber);
    if (owner === 'yargitay' || owner === 'danistay') {
      const allowed: BedestenCourtType[] =
        owner === 'yargitay' ? ['yargitay', 'kyb'] : ['danistay'];
      courtTypes ??= owner === 'yargitay' ? ['yargitay'] : ['danistay'];
      if (courtTypes.some((c) => !allowed.includes(c))) {
        throw validationFailed('invalid_arguments', 'bedesten');
      }
      birimAdi = name;
    } else {
      warnings.push('chamber_ignored');
    }
  }
  courtTypes ??= [...BEDESTEN_COURT_TYPES];
  if (args.date_from && args.date_to && args.date_from > args.date_to) {
    throw validationFailed('invalid_arguments', 'bedesten');
  }
  // Esas/karar no API'de süzgeç değildir: tırnaklı zorunlu ifade + sonuçta eşitlik süzmesi (§5.7.1).
  // portal ifadede "/" görünce ADALET_PARAMETER_VALIDATION_EXCEPTION döner (2026-10-10
  // denemesi); numara "2017 1615" biçiminde aranır, eşitlik süzmesi kanonik "2017/1615" ile yapılır.
  let phrase = args.query
    .normalize('NFC')
    .trim()
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 $2');
  const esasNo = canonicalCaseNo(args.esas_no);
  const kararNo = canonicalCaseNo(args.karar_no);
  if (esasNo !== null || kararNo !== null) {
    phrase = [esasNo, kararNo]
      .filter((v): v is string => v !== null)
      .map((v) => `+"${v.replace('/', ' ')}"`)
      .join(' ');
    warnings.push('esas_postfiltered');
  }
  const body: BedestenSearchBody = {
    pageSize: args.page_size,
    pageNumber: args.page,
    itemTypeList: courtTypes.map((c) => BEDESTEN_ITEM_TYPES[c]),
    phrase,
    ...(birimAdi ? { birimAdi } : {}),
    ...bedestenRange(args.date_from, args.date_to),
  };
  return { body, warnings, courtTypes };
}

export async function searchDecisions(
  deps: ToolDeps,
  args: McpSearchDecisionsArgs,
  ctx: CallCtx,
): Promise<McpSearchDecisionsResult> {
  if (!deps.enabled.has(args.source)) {
    throw new SourceError('SOURCE_NOT_IN_COVERAGE', 'source_disabled', { source: args.source });
  }
  if (containsPii(args.query))
    throw new SourceError('SOURCE_PII_BLOCKED', null, { source: args.source });
  const res =
    args.source === 'bedesten'
      ? await searchBedesten(deps, args, ctx)
      : args.source === 'anayasa'
        ? await searchAnayasa(deps, args, ctx)
        : await searchUyusmazlik(deps, args, ctx);
  const t = deps.now();
  for (const r of res.value.results) {
    deps.decisionMeta.set(
      `${r.source}:${r.document_id}`,
      r,
      t,
      DECISION_META_TTL_MS,
      DECISION_META_TTL_MS,
    );
  }
  return {
    source: args.source,
    page: args.page,
    page_size: args.page_size,
    ...res.value,
    status: res.staleAsOf ? 'stale' : 'ok',
    cached: res.cached,
    stale_as_of: res.staleAsOf,
  };
}

async function searchBedesten(
  deps: ToolDeps,
  args: McpSearchDecisionsArgs,
  ctx: CallCtx,
): Promise<Cached<Page>> {
  const plan = planBedestenSearch(args);
  const key = canonKey({
    v: 1,
    op: 'search_decisions',
    source: args.source,
    scope: ctx.cacheScope === 'org' ? ctx.org : 'shared',
    q: plan.body.phrase,
    item_types: plan.body.itemTypeList,
    birim: plan.body.birimAdi ?? null,
    from: args.date_from,
    to: args.date_to,
    esas: canonicalCaseNo(args.esas_no),
    karar: canonicalCaseNo(args.karar_no),
    page: args.page,
    page_size: args.page_size,
  });
  return cachedFetch<Page>(deps, 'bedesten', key, deps.cfg.searchTtlHours * HOUR_MS, async () => {
    const raw = await bedestenSearch(deps.gateway, plan.body, ctx.priority);
    const today = isoDay(deps.now());
    let results = raw.items
      .map((it) => normalizeSearchItem(it, today))
      .filter((r): r is NormalizedDecisionValue => r !== null);
    // Kesin eşleme: daire `birimAdi` ile, yıl/sıra normalize `esas_no`/`karar_no` ile (kanonik biçim).
    const esasNo = canonicalCaseNo(args.esas_no);
    const kararNo = canonicalCaseNo(args.karar_no);
    if (esasNo !== null) results = results.filter((r) => r.esas_no === esasNo);
    if (kararNo !== null) results = results.filter((r) => r.karar_no === kararNo);
    const warnings = [...plan.warnings];
    if (results.length > args.page_size) {
      results = results.slice(0, args.page_size);
      warnings.push('results_truncated');
    }
    const start = raw.start ?? (args.page - 1) * args.page_size;
    const total = raw.total;
    return {
      total,
      has_more: total === null ? null : start + raw.items.length < total,
      results,
      warnings,
    };
  });
}
