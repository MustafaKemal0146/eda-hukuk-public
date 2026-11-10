// Gateway (020 §1-§2): kapı → çözüm → maskeleme ara katmanı → sağlayıcı. Ham LanguageModel paket
// dışına verilmez; dışarı yalnız tur akışı çıkar (kapı ve maskeleme atlanamaz).
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import { type ModelMessage, stepCountIs, streamText, type ToolSet, wrapLanguageModel } from 'ai';
import { egressGuardMiddleware } from '../middleware/egress-guard.ts';
import { type MaskerPort, maskingMiddleware } from '../middleware/masking.ts';
import {
  ANTHROPIC_PREFIX_CACHE,
  anthropicModel,
  anthropicProviderOptions,
} from '../providers/anthropic.ts';
import { deepseekModel, deepseekProviderOptions, deepseekUserId } from '../providers/deepseek.ts';
import { type MockFixture, mockModel } from '../providers/mock.ts';
import type { AiCatalog } from './catalog.ts';
import { type Candidate, decide, type GateEnv, type GateInput } from './gate.ts';

export type GatewayOptions = {
  catalog: AiCatalog;
  env: GateEnv;
  secrets: {
    deepseekApiKey: string | null;
    anthropicApiKey?: string | null;
    pseudonymKey: Uint8Array;
  };
  /** Mock senaryo yükleyici (fixtures/<task>/<ad>.json); yalnız MOCK_LLM. */
  loadFixture: (task: string, scenario: string) => MockFixture | null;
};

export type TurnInput = {
  gate: GateInput;
  orgId: string | null;
  /** Gerçek maskeleyici (KvkkMasker); kurulmazsa NullMasker fail-closed reddeder. */
  masker: MaskerPort;
  instructions: string;
  messages: ModelMessage[];
  tools: ToolSet;
  mockScenario: string | null;
  abortSignal: AbortSignal;
  /**
   * İstek bağlamındaki Anthropic anahtarı (büro/baro veya kullanıcı; #54 BYOK). Verilirse sunucunun ortak
   * anahtarı yerine kullanılır; yalnız bu istek süresince bellekte durur, kalıcı değildir.
   */
  anthropicApiKey?: string | null;
};

/**
 * Maskeleme ara katmanı (dış) + egress bekçisi (iç) ile sarılmış model (020 §9.1). Ham model paket
 * dışına verilmez; maskeleme atlanamaz ve kapatılamaz.
 */
export function guardedModel(base: LanguageModelV4, masker: MaskerPort): LanguageModelV4 {
  return wrapLanguageModel({
    model: base,
    middleware: [maskingMiddleware(masker), egressGuardMiddleware(masker)],
  });
}

export class GatewayDenied extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export type TurnBadge = {
  providerId: string;
  region: 'TR' | 'EU' | 'US' | 'CN' | 'NONE';
  modelLabel: string;
  dataClass: 'public' | 'client' | 'case';
  thinking: 'off' | 'low' | 'medium' | 'high';
  notices: ('simulation' | 'beta_synthetic')[];
};

export function createGateway(opts: GatewayOptions) {
  function baseModel(
    c: Candidate,
    scenario: string | null,
    anthropicKey: string | null,
  ): LanguageModelV4 {
    if (c.provider.kind === 'mock') {
      const fixture =
        opts.loadFixture('chat', scenario ?? 'default') ?? opts.loadFixture('chat', 'default');
      if (!fixture) throw new GatewayDenied('AI_MOCK_FIXTURE_MISSING');
      return mockModel(fixture);
    }
    if (c.provider.kind === 'deepseek') {
      if (!opts.secrets.deepseekApiKey) throw new GatewayDenied('AI_PROVIDER_NOT_CONFIGURED');
      return deepseekModel(
        c.provider,
        c.model,
        { apiKey: opts.secrets.deepseekApiKey, pseudonymKey: opts.secrets.pseudonymKey },
        true,
      );
    }
    if (c.provider.kind === 'anthropic') {
      const key = anthropicKey ?? opts.secrets.anthropicApiKey;
      if (!key) throw new GatewayDenied('AI_PROVIDER_NOT_CONFIGURED');
      return anthropicModel(c.provider, c.model, key);
    }
    throw new GatewayDenied('AI_PROVIDER_NOT_IMPLEMENTED');
  }

  return {
    /** Simülasyon (mock) kipinde mi: gerçek sağlayıcı anahtarı aranmaz (#54). */
    usesMock(): boolean {
      return opts.env.mockLlm;
    },

    /** Kapı kararı + rozet (rezervasyon ve `start` meta verisi için; sağlayıcıya dokunmaz). */
    plan(input: Pick<TurnInput, 'gate'>): { candidate: Candidate; badge: TurnBadge } {
      const d = decide(opts.catalog, opts.env, input.gate);
      if (!d.ok) throw new GatewayDenied(d.code);
      const candidate = d.candidates[0] as Candidate;
      return {
        candidate,
        badge: {
          providerId: candidate.provider.id,
          region: candidate.provider.region,
          modelLabel: candidate.model.label,
          dataClass: d.dataClass,
          thinking: candidate.model.thinking,
          notices: d.notices,
        },
      };
    },

    streamTurn(input: TurnInput, candidate: Candidate) {
      const model = guardedModel(
        baseModel(candidate, input.mockScenario, input.anthropicApiKey ?? null),
        input.masker,
      );
      const maxSteps = CONFIG_DEFAULTS['chat.maxStepsPerTurn'];
      const kind = candidate.provider.kind;
      return streamText({
        model,
        instructions:
          kind === 'anthropic'
            ? {
                role: 'system',
                content: input.instructions,
                providerOptions: ANTHROPIC_PREFIX_CACHE,
              }
            : input.instructions,
        messages: input.messages,
        tools: input.tools,
        stopWhen: stepCountIs(maxSteps),
        // Son adımda araç kapalı: model elindeki kaynaklarla yanıtlar (022 §3.8).
        prepareStep: ({ stepNumber }) =>
          stepNumber >= maxSteps - 1 ? { toolChoice: 'none' as const } : {},
        maxOutputTokens: Math.min(candidate.model.maxOutputTokens, 8000),
        ...(candidate.model.thinking === 'off' && kind !== 'anthropic' ? { temperature: 0.3 } : {}),
        providerOptions:
          kind === 'deepseek'
            ? deepseekProviderOptions(
                candidate.model,
                deepseekUserId(opts.secrets.pseudonymKey, input.orgId),
              )
            : kind === 'anthropic'
              ? anthropicProviderOptions(candidate.model)
              : {},
        maxRetries: 1,
        abortSignal: input.abortSignal,
      });
    },
  };
}

export type Gateway = ReturnType<typeof createGateway>;
