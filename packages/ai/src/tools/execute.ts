// Araç yürütücüsü (021 §4.12, §4.16): 9 tanım üretilmiş kanonik JSON'dan (tools.lock.json) kurulur;
// her çağrıda Zod şeması + sunucu kuralları; tur başı en çok 4 çağrı, en çok 3 eşzamanlı; sonuç
// token bütçesi kalan bütçeyle kısaltılır. Araç hatası akış hatası değildir: modele isError döner.
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { LLM_TOOLS } from '@eda/contracts/tools';
import { LLM_TOOL_DEFS as generated } from '@eda/contracts/tools/generated';
import { jsonSchema, type ToolSet, tool } from 'ai';
import type { ToolContext } from './context.ts';
import { getDecision, searchDecisions } from './handlers/decisions.ts';
import { getLegislationArticle, searchLegislation } from './handlers/legislation.ts';
import type { ToolOutcome } from './handlers/types.ts';
import { TOOL_LABELS } from './labels.ts';
import { TOOL_MESSAGES } from './messages.ts';
import { estimateTokens, truncateToTokens } from './serialize.ts';

/** Araç sonucu kökeni (026 §5): yürütücü yazar, maskeleme ara katmanı yalnız bu etikete güvenir.
 * Dilimde arama araçları canlı kaynaktır (korpus P14); dosya araması dava aracı sonucudur. */
const RESULT_ORIGIN: Readonly<Record<string, 'live_source' | 'case_tool_result' | 'system'>> = {
  search_decisions: 'live_source',
  get_decision: 'live_source',
  search_legislation: 'live_source',
  get_legislation_article: 'live_source',
  search_case_files: 'case_tool_result',
};

type Handler = (
  ctx: ToolContext,
  input: never,
  callId: string,
  signal: AbortSignal,
) => Promise<ToolOutcome>;

const HANDLERS: Record<string, Handler> = {
  search_decisions: searchDecisions as Handler,
  get_decision: getDecision as Handler,
  search_legislation: searchLegislation as Handler,
  get_legislation_article: getLegislationArticle as Handler,
};

/** Basit sayaçlı semafor: aynı anda en çok `limit` iş. */
function semaphore(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((r) => queue.push(r));
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

export type ToolOutput = { text: string; isError: boolean };

const DOCUMENT_TOOLS = new Set(['create_document', 'edit_document', 'submit_outline']);

/**
 * Belge niyeti kapısı (sunucu kuralı): kullanıcı belge yazma dediyse hiçbir belge aracı çalışmaz;
 * belge istenmediyse (ve dilekçe modu kapalıysa) yeni belge başlatılamaz. Araç seti değişmez
 * (önek önbelleği, 021 §3); yalnız yürütme reddedilir.
 */
export function documentGate(toolName: string, ctx: ToolContext): string | null {
  if (!DOCUMENT_TOOLS.has(toolName) || ctx.documentIntent === undefined) return null;
  if (ctx.documentIntent === 'forbid') return TOOL_MESSAGES.documentForbidden;
  if (
    toolName === 'create_document' &&
    ctx.documentIntent === 'neutral' &&
    ctx.petitionMode !== true
  ) {
    return TOOL_MESSAGES.documentNotRequested;
  }
  return null;
}

export function buildToolSet(
  ctx: ToolContext,
  opts: { strict: boolean } = { strict: true },
): ToolSet {
  const run = semaphore(CONFIG_DEFAULTS['chat.maxParallelTools']);
  const contracts = new Map<string, (typeof LLM_TOOLS)[number]>(LLM_TOOLS.map((t) => [t.name, t]));
  const set: ToolSet = {};
  for (const def of generated) {
    const contract = contracts.get(def.name);
    if (!contract) throw new Error(`araç sözleşmesi yok: ${def.name}`);
    set[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.parameters as Parameters<typeof jsonSchema>[0]),
      ...(opts.strict ? { strict: true } : {}),
      execute: async (rawInput: unknown, { toolCallId, abortSignal }): Promise<ToolOutput> => {
        const signal = abortSignal ?? new AbortController().signal;
        if (ctx.budget.calls <= 0) return { text: TOOL_MESSAGES.budgetExhausted, isError: true };
        ctx.budget.calls -= 1;
        const label = TOOL_LABELS[def.name] ?? def.name;
        const base = { stage: 'tool' as const, label, toolName: def.name, callId: toolCallId };
        ctx.emit({ type: 'pipeline', data: { ...base, status: 'started' } });
        const outcome = await run(async (): Promise<ToolOutcome> => {
          const parsed = contract.inputSchema.safeParse(rawInput);
          if (!parsed.success) {
            return {
              text: `Hata: Geçersiz araç girdisi (${parsed.error.issues[0]?.path.join('.') ?? ''}).`,
              isError: true,
            };
          }
          const rule = (contract.serverRules as (i: unknown) => string | null)(parsed.data);
          if (rule) return { text: `Hata: ${rule}`, isError: true };
          const gated = documentGate(def.name, ctx);
          if (gated) return { text: gated, isError: true };
          const handler = HANDLERS[def.name];
          if (!handler) {
            return {
              text: DOCUMENT_TOOLS.has(def.name)
                ? TOOL_MESSAGES.documentToolsOff
                : def.name === 'search_case_files'
                  ? TOOL_MESSAGES.noCase
                  : TOOL_MESSAGES.notEnabled,
              isError: true,
            };
          }
          return handler(ctx, parsed.data as never, toolCallId, signal);
        }).catch((): ToolOutcome => ({ text: TOOL_MESSAGES.unavailable, isError: true }));
        // İş yapmadan "hak doldu" notu dönen çağrı, modelin kalan araç hakkını tüketmez (#12).
        if (outcome.refundCall) ctx.budget.calls += 1;
        if (outcome.notice) {
          ctx.emit({
            type: 'notice',
            code: outcome.notice,
            message:
              outcome.notice === 'source_busy'
                ? 'Resmî kaynak şu an yoğun.'
                : 'Resmî kaynağa şu an ulaşılamıyor.',
          });
        }
        ctx.emit({
          type: 'pipeline',
          data: {
            ...base,
            status: outcome.isError ? 'error' : 'done',
            ...(outcome.detail ? { detail: outcome.detail } : {}),
          },
        });
        // Tur toplamı kalan bütçe olarak işler (021 §4.12).
        const cap = Math.min(
          def.name.startsWith('search')
            ? CONFIG_DEFAULTS['tools.searchResultMaxTokens']
            : CONFIG_DEFAULTS['tools.fetchMaxTokens'],
          ctx.budget.resultTokens,
        );
        if (cap < 200) return { text: TOOL_MESSAGES.budgetExhausted, isError: true };
        const text = truncateToTokens(outcome.text, cap, '…[kısaltıldı]');
        ctx.budget.resultTokens -= estimateTokens(text);
        return { text, isError: outcome.isError };
      },
      toModelOutput: ({ output }: { output: ToolOutput }) => {
        const providerOptions = { eda: { origin: RESULT_ORIGIN[def.name] ?? 'system' } };
        return output.isError
          ? { type: 'error-text' as const, value: output.text, providerOptions }
          : { type: 'text' as const, value: output.text, providerOptions };
      },
    });
  }
  return set;
}

export function newTurnBudget(): ToolContext['budget'] {
  return {
    calls: CONFIG_DEFAULTS['chat.maxToolCallsPerTurn'],
    liveSearches: CONFIG_DEFAULTS['sources.turnMaxLiveSearches'],
    liveFetches: CONFIG_DEFAULTS['sources.turnMaxLiveFetches'],
    resultTokens: CONFIG_DEFAULTS['tools.turnResultMaxTokens'],
  };
}
