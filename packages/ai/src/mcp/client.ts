// yargi-mcp ince istemcisi (021 §6.1–§6.2): @modelcontextprotocol/client 2.3.1, Streamable HTTP, protokol
// 2026-07-28'e sabit (server/discover). Uzun ömürlü nesne; her çağrı bağımsız POST ve kendi JWT'sini taşır
// (`org` çağrı bağlamından AsyncLocalStorage ile imzalayıcıya geçer). Vekil yok: NO_PROXY içinde yargi-mcp.
import { AsyncLocalStorage } from 'node:async_hooks';
import {
  MCP_META_CACHE_SCOPE,
  MCP_META_PRIORITY,
  MCP_PROTOCOL_VERSION,
  type McpCacheScope,
  type McpPriority,
  McpToolError,
  type McpToolName,
} from '@eda/contracts/mcp';
import {
  Client,
  type FetchLike,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { type McpResult, transportError } from './errors.ts';
import { loadServiceJwtSigner, type ServiceJwtSigner, SYSTEM_ORG } from './jwt.ts';

export type YargiMcpCallOptions = {
  /** deriveOrgClaim çıktısı; verilmezse SYSTEM_ORG. */
  org?: string;
  priority: McpPriority;
  cacheScope?: McpCacheScope;
  traceparent?: string;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type YargiMcpClient = {
  callTool(
    name: McpToolName,
    args: Record<string, unknown>,
    opts: YargiMcpCallOptions,
  ): Promise<McpResult<unknown>>;
  /** `tools/list` adları (sıra korunur); sözleşme karşılaştırması için. */
  listToolNames(): Promise<string[]>;
  close(): Promise<void>;
};

export type YargiMcpClientOptions = {
  url: string;
  audience: string;
  /** Biri zorunlu: dosya yolu (prod) veya hazır imzalayıcı (test). */
  privateKeyFile?: string;
  signer?: ServiceJwtSigner;
  fetch?: FetchLike;
  connectTimeoutMs?: number;
};

const DEFAULT_CONNECT_TIMEOUT_MS = 5000;

export async function createYargiMcpClient(opts: YargiMcpClientOptions): Promise<YargiMcpClient> {
  const signer =
    opts.signer ??
    (opts.privateKeyFile
      ? await loadServiceJwtSigner({ privateKeyFile: opts.privateKeyFile, audience: opts.audience })
      : null);
  if (!signer) throw new Error('yargi-mcp istemcisi için imza anahtarı gerekli');
  const als = new AsyncLocalStorage<string>();
  const baseFetch: FetchLike = opts.fetch ?? fetch;
  const authFetch: FetchLike = async (input, init) => {
    const token = await signer.sign(als.getStore() ?? SYSTEM_ORG);
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${token}`);
    return baseFetch(input, { ...init, headers });
  };

  let client: Client | null = null;
  let connecting: Promise<Client> | null = null;

  const connect = (): Promise<Client> => {
    if (client) return Promise.resolve(client);
    connecting ??= als.run(SYSTEM_ORG, async () => {
      const c = new Client(
        { name: 'eda-ai', version: '0.0.0' },
        { versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } } },
      );
      const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
        fetch: authFetch,
        redirectPolicy: 'same-origin',
      });
      try {
        await c.connect(transport, {
          timeout: opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        });
      } finally {
        connecting = null;
      }
      client = c;
      return c;
    });
    return connecting;
  };

  const reset = async (): Promise<void> => {
    const c = client;
    client = null;
    await c?.close().catch(() => undefined);
  };

  return {
    async callTool(name, args, call) {
      let c: Client;
      try {
        c = await connect();
      } catch (err) {
        return { ok: false, error: transportError(isTimeout(err) ? 'timeout' : 'network') };
      }
      try {
        const res = await als.run(call.org ?? SYSTEM_ORG, () =>
          c.callTool(
            {
              name,
              arguments: args,
              _meta: {
                [MCP_META_PRIORITY]: call.priority,
                [MCP_META_CACHE_SCOPE]: call.cacheScope ?? 'shared',
                ...(call.traceparent ? { traceparent: call.traceparent } : {}),
              },
            },
            { timeout: call.timeoutMs, ...(call.signal ? { signal: call.signal } : {}) },
          ),
        );
        if (res.isError) {
          const parsed = McpToolError.safeParse(res.structuredContent);
          if (parsed.success) return { ok: false, error: { ...parsed.data.error, origin: 'tool' } };
          // SDK girdi doğrulaması yapılandırılmış gövde döndürmez (yalnız metin).
          return {
            ok: false,
            error: {
              code: 'VALIDATION_FAILED',
              reason: 'invalid_arguments',
              retry_after_ms: null,
              source: null,
              origin: 'input_rejected',
            },
          };
        }
        return { ok: true, value: res.structuredContent };
      } catch (err) {
        if (err instanceof SdkError && err.code === SdkErrorCode.InvalidResult) {
          return {
            ok: false,
            error: { ...transportError('parse_error'), origin: 'output_invalid' },
          };
        }
        if (err instanceof ProtocolError) {
          return {
            ok: false,
            error: {
              code: 'VALIDATION_FAILED',
              reason: 'invalid_arguments',
              retry_after_ms: null,
              source: null,
              origin: 'input_rejected',
            },
          };
        }
        await reset();
        return { ok: false, error: transportError(isTimeout(err) ? 'timeout' : 'network') };
      }
    },
    async listToolNames() {
      const c = await connect();
      const res = await als.run(SYSTEM_ORG, () => c.listTools(undefined, { cacheMode: 'refresh' }));
      return res.tools.map((t) => t.name);
    },
    close: reset,
  };
}

function isTimeout(err: unknown): boolean {
  return (
    (err instanceof SdkError && err.code === SdkErrorCode.RequestTimeout) ||
    (err instanceof Error && err.name === 'TimeoutError')
  );
}
