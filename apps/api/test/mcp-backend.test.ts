// paralel araç çağrılarında SOURCE_BUSY sınırlı bekleme ile bir kez yeniden denenir.
import { SourceError } from '@eda/ai';
import type { McpResult, YargiMcpClient } from '@eda/ai/mcp';
import { describe, expect, it } from 'vitest';
import { createMcpBackend, strictPhrase } from '../src/chat/mcp-backend.ts';

type Reply = McpResult<unknown>;

const busy = (ms: number | null): Reply => ({
  ok: false,
  error: { code: 'SOURCE_BUSY', reason: null, retry_after_ms: ms, source: null, origin: 'tool' },
});
const down: Reply = {
  ok: false,
  error: {
    code: 'SOURCE_UNAVAILABLE',
    reason: 'network',
    retry_after_ms: null,
    source: null,
    origin: 'tool',
  },
};

function fakeClient(replies: Reply[]): { client: YargiMcpClient; calls: string[] } {
  const calls: string[] = [];
  const client: YargiMcpClient = {
    async callTool(name) {
      calls.push(name);
      return replies.shift() ?? down;
    },
    async listToolNames() {
      return [];
    },
    async close() {},
  };
  return { client, calls };
}

const legislation = { query: 'kira tahliye taahhüdü', lawNo: null };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof SourceError ? e.code : 'other';
  }
}

describe('mcp-backend SOURCE_BUSY yeniden denemesi (AS-0060)', () => {
  it('kısa bekleme önerisinde bekleyip bir kez yeniden dener', async () => {
    const { client, calls } = fakeClient([busy(3000), down]);
    const waits: number[] = [];
    const backend = createMcpBackend(client, async (ms) => {
      waits.push(ms);
    });
    const code = await codeOf(backend.searchLegislation(legislation, new AbortController().signal));
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([3000]);
    expect(code).toBe('SOURCE_UNAVAILABLE');
  });

  it('uzun bekleme önerisinde veya ikinci meşgulde yeniden denemez', async () => {
    const long = fakeClient([busy(60_000)]);
    const b1 = createMcpBackend(long.client, async () => {});
    expect(await codeOf(b1.searchLegislation(legislation, new AbortController().signal))).toBe(
      'SOURCE_BUSY',
    );
    expect(long.calls).toHaveLength(1);

    const twice = fakeClient([busy(1000), busy(1000)]);
    const b2 = createMcpBackend(twice.client, async () => {});
    expect(await codeOf(b2.searchLegislation(legislation, new AbortController().signal))).toBe(
      'SOURCE_BUSY',
    );
    expect(twice.calls).toHaveLength(2);
  });

  it('iptal edilen turda beklemeden çıkar', async () => {
    const { client, calls } = fakeClient([busy(3000)]);
    const ac = new AbortController();
    ac.abort();
    const backend = createMcpBackend(client);
    expect(await codeOf(backend.searchLegislation(legislation, ac.signal))).toBe('other');
    expect(calls).toHaveLength(1);
  });

  it('strictPhrase çok terimli düz sorguyu zorunlu terimlere çevirir', () => {
    expect(strictPhrase('kira tahliye taahhüdü')).toBe('+kira +tahliye +taahhüdü');
    expect(strictPhrase('"tahliye taahhüdü"')).toBeNull();
  });
});
