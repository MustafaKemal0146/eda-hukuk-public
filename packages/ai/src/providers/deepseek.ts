// DeepSeek adaptörü (020 §7). Model kimliği katalogdan; thinking her çağrıda açıkça; araçlı istekler
// /beta ucuna strict araçlarla gider; user_id büro bazlı HMAC (kişisel veri değil).
import { createHmac } from 'node:crypto';
import { createDeepSeek } from '@ai-sdk/deepseek';
import type { LanguageModelV4, SharedV4ProviderOptions } from '@ai-sdk/provider';
import type { ModelRow, ProviderRow } from '../gateway/catalog.ts';

export type DeepSeekSecrets = { apiKey: string; pseudonymKey: Uint8Array };

export function deepseekUserId(pseudonymKey: Uint8Array, orgId: string | null): string {
  if (orgId === null) return 'o_platform';
  const mac = createHmac('sha256', pseudonymKey)
    .update(Buffer.concat([Buffer.from('eda/deepseek-user-id/v1'), Buffer.from(orgId)]))
    .digest('hex');
  return `o_${mac.slice(0, 32)}`;
}

export function deepseekModel(
  provider: ProviderRow,
  model: ModelRow,
  secrets: DeepSeekSecrets,
  withTools: boolean,
): LanguageModelV4 {
  const base = (provider.baseUrl ?? 'https://api.deepseek.com').replace(/\/$/, '');
  const ds = createDeepSeek({ apiKey: secrets.apiKey, baseURL: withTools ? `${base}/beta` : base });
  return ds.languageModel(model.modelId);
}

/** providerOptions.deepseek: thinking alanı hiçbir zaman boş bırakılmaz (020 §7 kural 2). */
export function deepseekProviderOptions(model: ModelRow, userId: string): SharedV4ProviderOptions {
  const thinking =
    model.thinking === 'off'
      ? { thinking: { type: 'disabled' } }
      : {
          thinking: { type: 'enabled' },
          reasoningEffort: model.thinking === 'low' ? 'low' : 'high',
        };
  return { deepseek: { ...thinking, userId } };
}
