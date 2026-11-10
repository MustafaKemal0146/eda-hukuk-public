// Uygulama kurulumu: ağ geçidi, araç bağımlılıkları, JWT doğrulayıcı ve /mcp rotası. main ve testler ortak.
import type { SourceCode } from '@eda/contracts/enums';
import type { EdaLogger } from '@eda/observability/logger';
import { createMcpHandler, type McpHttpHandler } from '@modelcontextprotocol/server';
import { createJwtVerifier, type JwtVerifier } from './auth/jwt.ts';
import { defaultSourcesConfig, type SourcesConfig } from './config/sources.ts';
import type { Transport } from './http/fetch.ts';
import { createMcpRoute, MAX_MCP_BODY_BYTES, type NodeRoute } from './http/mcp-route.ts';
import type { ResilienceState } from './resilience/state.ts';
import { createMcpServer } from './server.ts';
import { UpstreamGateway } from './sources/gateway.ts';
import { createToolDeps, type ToolDeps } from './tools/context.ts';

export type AppOptions = {
  transport: Transport;
  publicKeyPem: string;
  audience: string;
  /** Etkin kaynaklar; `eda:cfg:sources` okuyucusu aynı kümeyi yerinde günceller. */
  enabledSources: Set<SourceCode>;
  userAgent: string;
  logger: EdaLogger;
  /** Kova, kesici, önbellek, tek uçuş kilidi (üretimde valkey-cache; resilience/state.ts). */
  state: ResilienceState;
  cfg?: SourcesConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

export type App = {
  route: NodeRoute;
  handler: McpHttpHandler;
  deps: ToolDeps;
  verify: JwtVerifier;
};

export async function createApp(opts: AppOptions): Promise<App> {
  const cfg = opts.cfg ?? defaultSourcesConfig();
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const reportDegraded = (op: string): void =>
    opts.logger.warn({ event: 'dependency.degraded', scope: 'valkey_cache', op });
  const gateway = new UpstreamGateway({
    transport: opts.transport,
    cfg,
    userAgent: opts.userAgent,
    now,
    sleep,
    random: opts.random ?? Math.random,
    limiter: opts.state.limiter,
    breakers: opts.state.breakers,
    reportDegraded,
  });
  const deps = createToolDeps({
    gateway,
    cfg,
    enabled: opts.enabledSources,
    now,
    sleep,
    resultCache: opts.state.resultCache,
    locks: opts.state.locks,
    reportDegraded,
  });
  const handler = createMcpHandler(
    (ctx) => createMcpServer(deps, ctx.authInfo?.clientId ?? 'sys', opts.logger),
    {
      legacy: 'reject',
      responseMode: 'json',
      maxRequestBodySize: MAX_MCP_BODY_BYTES,
      onerror: () => opts.logger.warn({ event: 'dependency.degraded', scope: 'mcp_handler' }),
    },
  );
  const verify = await createJwtVerifier({
    publicKeyPem: opts.publicKeyPem,
    audience: opts.audience,
  });
  const route = createMcpRoute({ verify, handler, logger: opts.logger });
  return { route, handler, deps, verify };
}
