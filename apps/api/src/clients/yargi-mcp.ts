// Paylaşılan yargi-mcp istemcisi (021 §6): sohbet araçları, Karar Arşivi ve Mevzuat uçları aynı tembel
// bağlantıyı kullanır. İlk kullanımda bağlanır; bağlanamazsa kaynak "erişilemedi" sayılır ve sonraki
// çağrı yeniden dener.
import { SourceError } from '@eda/ai';
import { createYargiMcpClient, type YargiMcpClient } from '@eda/ai/mcp';
import type { EdaLogger } from '@eda/observability/logger';
import type { ApiConfig } from '../config/load.ts';

export type McpClientProvider = () => Promise<YargiMcpClient>;

export function lazyMcp(config: ApiConfig, logger: EdaLogger): McpClientProvider {
  let pending: Promise<YargiMcpClient> | null = null;
  return () => {
    pending ??= createYargiMcpClient({
      url: config.env.YARGI_MCP_URL,
      audience: 'yargi-mcp',
      privateKeyFile: String(config.env.INTERNAL_JWT_PRIVATE_KEY_FILE),
    }).catch((err: unknown) => {
      pending = null;
      logger.warn({
        event: 'mcp.connect_failed',
        errorType: err instanceof Error ? err.name : 'unknown',
      });
      throw new SourceError('SOURCE_UNAVAILABLE');
    });
    return pending;
  };
}
