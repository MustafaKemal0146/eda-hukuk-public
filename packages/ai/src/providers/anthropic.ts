// Claude (Anthropic) adaptörü (P07d; 020 §3.2). Model kimliği katalogdan (Models API ile doğrulandı).
// Kurallar: user_id/metadata GÖNDERİLMEZ; thinking her istekte açık (kapalı veya adaptive + effort);
// kararlı önek (araç tanımları + sistem direktifi) tek önbellek işaretiyle; max_tokens açık.
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider';
import type { ModelRow, ProviderRow } from '../gateway/catalog.ts';

export function anthropicModel(
  provider: ProviderRow,
  model: ModelRow,
  apiKey: string,
): LanguageModelV4 {
  const anthropic = createAnthropic({
    apiKey,
    ...(provider.baseUrl ? { baseURL: provider.baseUrl } : {}),
  });
  return anthropic.languageModel(model.modelId);
}

/**
 * `ai_models.thinking` → Anthropic: off → thinking kapalı (effort medium; kapatma yalnız ≤ high
 * effort'ta mümkündür); low/medium/high → adaptive + aynı effort. Bazı modellerde (Sonnet 5.5)
 * thinking kapatılamaz; SDK bunu adaptive'e çevirir ve uyarı üretir.
 */
export function anthropicProviderOptions(model: ModelRow): SharedV4ProviderOptions {
  return model.thinking === 'off'
    ? { anthropic: { thinking: { type: 'disabled' }, effort: 'medium' } }
    : { anthropic: { thinking: { type: 'adaptive' }, effort: model.thinking } };
}

/** Önek önbellek işareti: sistem direktifinin sonuna (araçlar + [1] önbelleğe girer; 020 §10). */
export const ANTHROPIC_PREFIX_CACHE: SharedV4ProviderOptions = {
  anthropic: { cacheControl: { type: 'ephemeral' } },
};
