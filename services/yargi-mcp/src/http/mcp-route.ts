// POST /mcp (021 §5.1): gövde ≤ 32 KB, EdDSA servis JWT'si zorunlu (ret: 401 gövdesiz), ardından
// SDK'nın web-standart işleyicisi (durumsuz, yalnız 2026-07-28, JSON yanıt kipi). GET /mcp → 405.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { EdaLogger } from '@eda/observability/logger';
import type { McpHttpHandler } from '@modelcontextprotocol/server';
import type { JwtVerifier } from '../auth/jwt.ts';

export const MAX_MCP_BODY_BYTES = 32 * 1024;

export type NodeRoute = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;

async function readBody(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const b = chunk as Buffer;
    total += b.length;
    if (total > max) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

function toHeaders(req: IncomingMessage): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    h.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  return h;
}

export function createMcpRoute(opts: {
  verify: JwtVerifier;
  handler: McpHttpHandler;
  logger: EdaLogger;
}): NodeRoute {
  return async (req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/mcp') return false;
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'POST' }).end();
      return true;
    }
    if (Number(req.headers['content-length'] ?? '0') > MAX_MCP_BODY_BYTES) {
      res.writeHead(413).end();
      req.resume();
      return true;
    }
    const auth = await opts.verify(req.headers.authorization);
    if (!auth) {
      opts.logger.warn({ event: 'auth.session.rejected', kind: 'service_jwt' });
      res.writeHead(401).end();
      req.resume();
      return true;
    }
    const body = await readBody(req, MAX_MCP_BODY_BYTES);
    if (body === null) {
      res.writeHead(413).end();
      return true;
    }
    const request = new Request(`http://yargi-mcp${req.url ?? '/mcp'}`, {
      method: 'POST',
      headers: toHeaders(req),
      body: new Uint8Array(body),
    });
    const response = await opts.handler.fetch(request, {
      authInfo: { token: 'service', clientId: auth.org, scopes: [] },
    });
    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
    return true;
  };
}
