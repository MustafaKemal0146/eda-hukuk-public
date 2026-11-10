// @tk TK-28
// KK-021-9: tools/list adları, sırası, annotations ve şemaları contracts'tan üretilenle aynı; HTTP sınırı
// (401 gövdesiz, 405, 413), structuredContent outputSchema'ya uyar; KK-021-18 log'da sorgu metni yok.
import {
  MCP_TOOL_NAMES,
  MCP_TOOLS,
  McpSearchDecisionsSuccess,
  McpToolError,
} from '@eda/contracts/mcp';
import { createLogger } from '@eda/observability/logger';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ed25519Pair,
  NULLS,
  replay,
  rpc,
  signToken,
  startTestServer,
  type TestServer,
} from '../helpers.ts';

type ToolDef = {
  name: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

const strip = (s: Record<string, unknown> | undefined): Record<string, unknown> => {
  const { $schema: _drop, ...rest } = s ?? {};
  return rest;
};

describe('KK-P11-1 / KK-021-9: yargi-mcp HTTP sözleşmesi', () => {
  const keys = ed25519Pair();
  const logLines: string[] = [];
  let srv: TestServer;
  const token = () => signToken(keys.privateKeyPem);

  beforeAll(async () => {
    const logger = createLogger({
      service: 'test',
      level: 'debug',
      destination: { write: (m: string) => logLines.push(m) },
    });
    srv = await startTestServer(keys.publicKeyPem, replay().transport, logger);
  });
  afterAll(() => srv.close());

  it('tools/list: ad ve sıra, annotations, şemalar contracts ile aynı, ttlMs/cacheScope', async () => {
    const res = await rpc(srv.url, await token(), 'tools/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { tools: ToolDef[]; ttlMs: number; cacheScope: string };
    };
    const tools = body.result.tools;
    expect(tools.map((t) => t.name)).toEqual([...MCP_TOOL_NAMES]);
    expect([body.result.ttlMs, body.result.cacheScope]).toEqual([3_600_000, 'public']);
    MCP_TOOLS.forEach((spec, i) => {
      const t = tools[i];
      expect(t?.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
      });
      expect(strip(t?.inputSchema)).toEqual(
        strip({ type: 'object', ...z.toJSONSchema(spec.inputSchema, { io: 'input' }) }),
      );
      expect(t?.outputSchema).toBeDefined();
    });
  });

  it('JWT yoksa 401 gövdesiz; GET 405; 32 KB üstü gövde 413', async () => {
    const r401 = await rpc(srv.url, null, 'tools/list');
    expect([r401.status, await r401.text()]).toEqual([401, '']);
    const r405 = await fetch(srv.url);
    expect(r405.status).toBe(405);
    const r413 = await fetch(srv.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: 'x'.repeat(33 * 1024),
    });
    expect(r413.status).toBe(413);
  });

  it('KK-P11-10 / KK-021-18: search_decisions ve get_decision; log sorgu, snippet, belge metni taşımaz', async () => {
    const res = await rpc(
      srv.url,
      await token(),
      'tools/call',
      {
        name: 'search_decisions',
        arguments: {
          source: 'bedesten',
          query: 'tahliye taahhüdü',
          court_types: ['yargitay'],
          ...NULLS,
          page: 1,
          page_size: 10,
        },
      },
      { 'eda/priority': 'interactive', 'eda/cacheScope': 'shared' },
    );
    const body = (await res.json()) as {
      result: { structuredContent: unknown; isError?: boolean };
    };
    expect(body.result.isError ?? false).toBe(false);
    expect(McpSearchDecisionsSuccess.parse(body.result.structuredContent).results).toHaveLength(10);
    const doc = await rpc(
      srv.url,
      await token(),
      'tools/call',
      {
        name: 'get_decision',
        arguments: { source: 'bedesten', document_id: '979779300', section: null },
      },
      { 'eda/priority': 'interactive' },
    );
    const docBody = (await doc.json()) as {
      result: { structuredContent: { sections: { markdown: string | null }[] }; isError?: boolean };
    };
    expect(docBody.result.isError ?? false).toBe(false);
    const fragments = docBody.result.structuredContent.sections
      .map((s) => (s.markdown ?? '').replace(/\s+/g, ' ').trim().slice(0, 40))
      .filter((f) => f.length >= 20);
    expect(fragments.length).toBeGreaterThan(0);
    const logs = logLines.join('');
    expect(logs).toContain('"query_hash"');
    expect(logs).toContain('"query_len"');
    expect(logs).not.toContain('tahliye');
    expect(logs).not.toContain('"snippet"');
    for (const f of fragments) expect(logs).not.toContain(f);
  });

  it('araç hatası isError + McpToolError gövdesi; 20 öğe sınırı aşılırsa ret', async () => {
    const res = await rpc(srv.url, await token(), 'tools/call', {
      name: 'get_decision',
      arguments: { source: 'bedesten', document_id: 'http://169.254.169.254/x', section: null },
    });
    const body = (await res.json()) as {
      result: { structuredContent: unknown; isError?: boolean };
    };
    expect(body.result.isError).toBe(true);
    expect(McpToolError.parse(body.result.structuredContent).error).toMatchObject({
      code: 'VALIDATION_FAILED',
      reason: 'invalid_document_id',
    });
    const many = await rpc(srv.url, await token(), 'tools/call', {
      name: 'search_decisions',
      arguments: {
        source: 'bedesten',
        query: 'kira',
        court_types: Array.from({ length: 25 }, () => 'yargitay'),
        ...NULLS,
        page: 1,
        page_size: 10,
      },
    });
    const mb = (await many.json()) as { result?: { isError?: boolean }; error?: unknown };
    expect(mb.error !== undefined || mb.result?.isError === true).toBe(true);
  });
});
