// Sağlayıcı/model kataloğu (020 §3): kaynağı DB (`app.ai_providers`, `app.ai_models`, `app.ai_task_routes`).
// Gateway kataloğu çağırandan alır; model kimliği koda yazılmaz (Y-…: 002 §12).
import { z } from 'zod';

export const ProviderRow = z.object({
  id: z.string(),
  kind: z.enum(['deepseek', 'azure', 'openai_compatible', 'anthropic', 'vertex', 'mock']),
  region: z.enum(['TR', 'EU', 'US', 'CN', 'NONE']),
  enabled: z.boolean(),
  priority: z.number().int(),
  allowedDataClasses: z.array(z.enum(['public', 'client', 'case'])),
  baseUrl: z.string().nullable(),
  /** `${SECRETS_DIR}/${secretRef}` (020 §3.1). */
  secretRef: z.string().nullable(),
});
export type ProviderRow = z.infer<typeof ProviderRow>;

export const ModelRow = z.object({
  alias: z.enum(['edai-flash', 'edai-pro']),
  providerId: z.string(),
  modelId: z.string(),
  label: z.string(),
  thinking: z.enum(['off', 'low', 'medium', 'high']),
  maxOutputTokens: z.number().int(),
  capabilities: z.object({ tools: z.boolean(), strictTools: z.boolean() }),
});
export type ModelRow = z.infer<typeof ModelRow>;

export const AiCatalog = z.object({
  providers: z.array(ProviderRow),
  models: z.array(ModelRow),
});
export type AiCatalog = z.infer<typeof AiCatalog>;
