// Test yardımcıları: replay taşıyıcı (ağsız), sayaçlı taşıyıcı, sahte saat, Ed25519 anahtar ve HTTP sunucu.
import { generateKeyPairSync } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import type { SourceCode } from '@eda/contracts/enums';
import { MCP_PROTOCOL_VERSION } from '@eda/contracts/mcp';
import { createLogger, type EdaLogger } from '@eda/observability/logger';
import { importPKCS8, SignJWT } from 'jose';
import { type App, createApp } from '../src/app.ts';
import { defaultSourcesConfig, type SourcesConfig } from '../src/config/sources.ts';
import type { Transport, UpstreamRequest, UpstreamResponse } from '../src/http/fetch.ts';
import { createReplayTransport } from '../src/http/fixtures.ts';
import { UpstreamGateway } from '../src/sources/gateway.ts';
import { type CallCtx, createToolDeps, type ToolDeps } from '../src/tools/context.ts';
import { type MemoryState, memoryState } from './memory-state.ts';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const CTX: CallCtx = { org: 'sys', priority: 'interactive', cacheScope: 'shared' };
export const NULLS = {
  chamber: null,
  date_from: null,
  date_to: null,
  esas_no: null,
  karar_no: null,
};
export const T0 = Date.parse('2026-10-10T12:00:00Z');

export type Counted = { transport: Transport; calls: UpstreamRequest[] };

export function counted(inner: Transport): Counted {
  const calls: UpstreamRequest[] = [];
  return {
    calls,
    transport: async (req) => {
      calls.push(req);
      return inner(req);
    },
  };
}

export function replay(): Counted {
  return counted(createReplayTransport(FIXTURES));
}

/** Sabit yanıt veren taşıyıcı (sentetik; dayanıklılık testleri için). */
export function scripted(
  fn: (req: UpstreamRequest, n: number) => UpstreamResponse | Error,
): Counted {
  let n = 0;
  return counted(async (req) => {
    const r = fn(req, n++);
    if (r instanceof Error) throw r;
    return r;
  });
}

export class FakeClock {
  t = T0;
  now = (): number => this.t;
  sleep = async (ms: number): Promise<void> => {
    this.t += ms;
  };
}

export function fastCfg(over: Partial<SourcesConfig> = {}): SourcesConfig {
  return {
    ...defaultSourcesConfig(),
    bedestenTokenIntervalMs: 1,
    anayasaTokenIntervalMs: 1,
    uyusmazlikTokenIntervalMs: 1,
    ...over,
  };
}

export type TestDeps = ToolDeps & { state: MemoryState; degraded: string[] };

/** Araç bağımlılıkları; `state` verilirse paylaşılır (iki replikayı taklit eder). */
export function makeDeps(opts: {
  transport: Transport;
  clock?: FakeClock;
  cfg?: SourcesConfig;
  enabled?: SourceCode[];
  state?: MemoryState;
}): TestDeps {
  const clock = opts.clock ?? new FakeClock();
  const cfg = opts.cfg ?? fastCfg();
  const state = opts.state ?? memoryState(cfg, clock.now);
  const degraded: string[] = [];
  const reportDegraded = (op: string): void => {
    degraded.push(op);
  };
  const gateway = new UpstreamGateway({
    transport: opts.transport,
    cfg,
    userAgent: 'EDA-Hukuk-Kaynak-Istemcisi/1.0 (+https://eda.localhost/guvenlik)',
    now: clock.now,
    sleep: clock.sleep,
    random: () => 0.5,
    limiter: state.limiter,
    breakers: state.breakers,
    reportDegraded,
  });
  const deps = createToolDeps({
    gateway,
    cfg,
    enabled: new Set(opts.enabled ?? ['bedesten', 'mevzuat']),
    now: clock.now,
    sleep: clock.sleep,
    resultCache: state.resultCache,
    locks: state.locks,
    reportDegraded,
  });
  return Object.assign(deps, { state, degraded });
}

export function ed25519Pair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export async function signToken(
  privateKeyPem: string,
  opts: {
    claims?: Record<string, unknown>;
    aud?: string;
    lifetimeSec?: number;
    iat?: number;
    header?: Record<string, unknown>;
  } = {},
): Promise<string> {
  const key = await importPKCS8(privateKeyPem, 'EdDSA');
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ org: 'sys', ...opts.claims })
    .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT', ...opts.header })
    .setAudience(opts.aud ?? 'yargi-mcp')
    .setIssuedAt(iat)
    .setExpirationTime(iat + (opts.lifetimeSec ?? 60))
    .sign(key);
}

export type TestServer = { url: string; app: App; server: Server; close: () => Promise<void> };

export async function startTestServer(
  publicKeyPem: string,
  transport: Transport,
  logger: EdaLogger = createLogger({ service: 'test', level: 'fatal' }),
): Promise<TestServer> {
  const cfg = fastCfg();
  const app = await createApp({
    transport,
    publicKeyPem,
    audience: 'yargi-mcp',
    enabledSources: new Set(['bedesten', 'mevzuat']),
    userAgent: 'EDA-Hukuk-Kaynak-Istemcisi/1.0 (+https://eda.localhost/guvenlik)',
    logger,
    state: memoryState(cfg, Date.now),
    cfg,
  });
  const server = createServer((req, res) => {
    void app.route(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    app,
    server,
    close: async () => {
      await app.handler.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** 2026-07-28 zarflı ham JSON-RPC isteği (SDK istemcisinin gönderdiği biçim). */
export async function rpc(
  url: string,
  token: string | null,
  method: string,
  params: Record<string, unknown> = {},
  meta: Record<string, unknown> = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-method': method,
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
  };
  if (method === 'tools/call' && typeof params.name === 'string') headers['mcp-name'] = params.name;
  if (token) headers.authorization = `Bearer ${token}`;
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientInfo': { name: 'test', version: '0.0.0' },
          'io.modelcontextprotocol/clientCapabilities': {},
          ...meta,
        },
      },
    }),
  });
}

/** Sentetik, metin katmanlı tek sayfalık PDF (Helvetica, ASCII). `text` boşsa metinsiz sayfa. */
export function syntheticPdf(lines: string[]): Uint8Array {
  const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const stream = lines.length
    ? `BT /F1 10 Tf 40 800 Td 12 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(' ')} ET`
    : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

export function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): UpstreamResponse {
  return { status, headers, body: JSON.stringify(body) };
}
