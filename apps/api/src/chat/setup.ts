// Sohbet bağımlılıklarının kurulumu (020 §3.4 açılış denetimleri). Yalnız development/test;
// beta-synthetic pilotunda yalnız DEV_REAL_LLM doluysa.
// Sağlayıcı anahtarı `${SECRETS_DIR}/${secret_ref}`; boşsa dev'de yalnız uyarı (mock varsayılan).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiCatalog, createGateway, loadBundledFixture } from '@eda/ai';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';
import type { EdaLogger } from '@eda/observability/logger';
import type { McpClientProvider } from '../clients/yargi-mcp.ts';
import type { ApiConfig } from '../config/load.ts';
import { uuidv7 } from '../middleware/request-id.ts';
import { createMcpBackend } from './mcp-backend.ts';
import { ActiveTurns, MemoryChatPersistence } from './persistence.ts';
import type { ChatDeps } from './turn.ts';

function readOptional(path: string): string | null {
  try {
    const v = readFileSync(path, 'utf8').trim();
    return v === '' ? null : v;
  } catch {
    return null;
  }
}

export function createChatDeps(
  config: ApiConfig,
  logger: EdaLogger,
  mcp: McpClientProvider,
): ChatDeps | undefined {
  const edaEnv = config.env.EDA_ENV;
  const devLike = edaEnv === 'development' || edaEnv === 'test';
  const syntheticPilot = edaEnv === 'beta-synthetic' && config.env.DEV_REAL_LLM !== undefined;
  if (!devLike && !syntheticPilot) return undefined;
  const catalog = AiCatalog.parse(AI_CATALOG_SEED);
  const secretsDir = String(config.env.SECRETS_DIR ?? '/run/secrets');
  const deepseekRef = catalog.providers.find((p) => p.kind === 'deepseek')?.secretRef;
  const deepseekApiKey = deepseekRef ? readOptional(join(secretsDir, deepseekRef)) : null;
  const anthropicRef = catalog.providers.find((p) => p.id === 'anthropic')?.secretRef;
  const anthropicApiKey = anthropicRef ? readOptional(join(secretsDir, anthropicRef)) : null;
  const realKey = { deepseek: deepseekApiKey, anthropic: anthropicApiKey } as const;
  const devReal = config.env.DEV_REAL_LLM;
  if (devReal && realKey[devReal] === null) {
    logger.warn({ event: 'ai.provider_secret_missing', provider: devReal });
  }
  const pseudonymKey = Buffer.from(config.secrets.get('HMAC_PSEUDONYM_KEY_FILE'), 'base64');
  const gateway = createGateway({
    catalog,
    env: {
      edaEnv,
      mockLlm: config.env.MOCK_LLM,
      devRealLlm: config.env.DEV_REAL_LLM ?? null,
    },
    secrets: { deepseekApiKey, anthropicApiKey, pseudonymKey },
    loadFixture: loadBundledFixture,
  });
  const backend = {
    searchDecisions: async (
      ...a: Parameters<ReturnType<typeof createMcpBackend>['searchDecisions']>
    ) => createMcpBackend(await mcp()).searchDecisions(...a),
    getDecision: async (...a: Parameters<ReturnType<typeof createMcpBackend>['getDecision']>) =>
      createMcpBackend(await mcp()).getDecision(...a),
    searchLegislation: async (
      ...a: Parameters<ReturnType<typeof createMcpBackend>['searchLegislation']>
    ) => createMcpBackend(await mcp()).searchLegislation(...a),
    getLegislationArticles: async (
      ...a: Parameters<ReturnType<typeof createMcpBackend>['getLegislationArticles']>
    ) => createMcpBackend(await mcp()).getLegislationArticles(...a),
  };
  logger.info({
    event: 'chat.slice_enabled',
    mockLlm: config.env.MOCK_LLM,
    devRealLlm: config.env.DEV_REAL_LLM ?? null,
  });
  return {
    gateway,
    backend,
    persistence: new MemoryChatPersistence(),
    active: new ActiveTurns(),
    pseudonymKey,
    logger,
    // Senaryo öneki yalnız mock içindir; sentetik pilotta kullanıcı metninden ayıklanmaz.
    allowScenarioPrefix: devLike,
    uuid: () => uuidv7(),
  };
}
