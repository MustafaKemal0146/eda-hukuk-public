// @tk TK-12
// Alıntı denetimi akış testi (025 §6): sahte araç sonucu + model metni → `data-citations` final
// durumları. Uyuşmayan alıntı `out_of_context` + `quote_mismatch` (engellemez); kanıt yoksa (kaynağa
// ulaşılamadı) durum değişmez; alıntısız atıf `verified` kalır; log alıntı içeriği taşımaz.
// Karar metinleri kurgusal biçim örnekleridir.
import {
  AiCatalog,
  createGateway,
  type DecisionHit,
  MockFixture,
  type SourceBackend,
  SourceError,
} from '@eda/ai';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { createAppSurface } from '../src/app.ts';
import { ActiveTurns, MemoryChatPersistence } from '../src/chat/persistence.ts';
import { createReadiness } from '../src/health/ready.ts';
import { uuidv7 } from '../src/middleware/request-id.ts';

const GEREKCE =
  'Somut olayda işçinin fazla çalışma ücretine hak kazanması için fazla çalışmanın yazılı delille ' +
  'ispatı gerekir. Mahkemece eksik inceleme ile hüküm kurulması isabetsizdir.';

const SEARCH_CALL = {
  type: 'tool-call' as const,
  toolCallId: 'call_1',
  toolName: 'search_decisions',
  input:
    '{"query": "fazla çalışma ispatı", "court_types": ["yargitay"], "chamber": null, "date_from": null, "date_to": null, "esas_no": null, "karar_no": null, "live": false, "page": null}',
};

/** Senaryo adı → son adımın model metni. */
const ANSWERS: Record<string, string> = {
  dogru_alinti: 'Kararda “fazla çalışmanın yazılı delille ispatı gerekir” denilmiştir [K1].',
  yanlis_alinti: 'Kararda "fazla çalışmanın tanık beyanıyla ispatı mümkündür" denilmiştir [K1].',
  alintisiz: 'Fazla çalışmanın yazılı delille ispatı gerektiği belirtilmiştir [K1].',
};

function fixture(scenario: string): MockFixture | null {
  const answer = ANSWERS[scenario];
  if (answer === undefined) return null;
  return MockFixture.parse({
    scenario,
    task: 'chat',
    steps: [
      {
        parts: [SEARCH_CALL],
        finishReason: 'tool-calls',
        usage: { inputTokens: 10, outputTokens: 10 },
      },
      {
        parts: [{ type: 'text-delta', delta: answer }],
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 10 },
      },
    ],
  });
}

const HIT: DecisionHit = {
  source: 'bedesten',
  document_id: '1000001',
  court_type: 'yargitay',
  court: 'Yargıtay',
  chamber: '9. Hukuk Dairesi',
  esas_no: '2024/100',
  karar_no: '2025/200',
  decision_date: '2025-01-02',
  title: 't',
  snippet: null,
  url: 'https://mevzuat.adalet.gov.tr/ictihat/1000001',
  retrieved_at: '2026-10-10',
};

function backend(opts: { snippet: string | null; failRead: boolean }) {
  const reads: string[] = [];
  const b: SourceBackend = {
    searchDecisions: async () => ({
      results: [{ ...HIT, snippet: opts.snippet }],
      hasMore: false,
      stale: false,
    }),
    getDecision: async (_s, id) => {
      reads.push(id);
      if (opts.failRead) throw new SourceError('SOURCE_UNAVAILABLE');
      return {
        ...HIT,
        text_status: 'ok',
        total_sections: 2,
        sections: [
          { no: 1, role: 'kunye', chars: 10, markdown: 'Künye' },
          { no: 2, role: 'gerekce', chars: GEREKCE.length, markdown: GEREKCE },
        ],
      };
    },
    searchLegislation: async () => ({ results: [] }),
    getLegislationArticles: async () => {
      throw new Error('beklenmeyen çağrı');
    },
  };
  return { b, reads };
}

function surface(b: SourceBackend, logs: string[]) {
  const logger = createLogger({
    service: 'eda-api-test',
    destination: { write: (line: string) => void logs.push(line) },
  });
  const ready = createReadiness({
    probes: [],
    cacheMs: 0,
    version: 'test',
    state: { draining: false },
  });
  const gateway = createGateway({
    catalog: AiCatalog.parse(AI_CATALOG_SEED),
    env: { edaEnv: 'test', mockLlm: true, devRealLlm: null },
    secrets: { deepseekApiKey: null, pseudonymKey: new Uint8Array(32) },
    loadFixture: (_task, scenario) => fixture(scenario),
  });
  return createAppSurface({
    surface: 'app',
    logger,
    state: { draining: false },
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 1024 * 1024,
    ready,
    chat: {
      gateway,
      backend: b,
      persistence: new MemoryChatPersistence(),
      active: new ActiveTurns(),
      pseudonymKey: new Uint8Array(32),
      logger,
      allowScenarioPrefix: true,
      uuid: () => uuidv7(),
    },
  }).app;
}

type Citation = { ref: string; status: string; reason?: string; blocking: string };

async function runScenario(
  scenario: string,
  opts: { snippet: string | null; failRead: boolean },
): Promise<{ citations: Citation[]; final: boolean; reads: string[]; logs: string[] }> {
  const { b, reads } = backend(opts);
  const logs: string[] = [];
  const app = surface(b, logs);
  const created = await app.request('/api/v1/conversations', { method: 'POST' });
  const { id } = (await created.json()) as { id: string };
  const res = await app.request(`/api/v1/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      trigger: 'submit-message',
      message: {
        id: uuidv7(),
        role: 'user',
        parts: [{ type: 'text', text: `/senaryo ${scenario} Fazla çalışma nasıl ispatlanır?` }],
      },
      regenerateMessageId: null,
      alias: 'edai-flash',
      mode: 'chat',
      scope: { sources: [], chamber: null, dateFrom: null, dateTo: null },
      attachments: [],
      mentions: [],
      documentId: null,
      documentBaseVersion: null,
      liveSearch: false,
    }),
  });
  expect(res.status).toBe(200);
  const parts = (await res.text())
    .split('\n\n')
    .filter((x) => x.startsWith('data: ') && !x.includes('[DONE]'))
    .map((x) => JSON.parse(x.slice(6)) as Record<string, unknown>);
  const part = parts.findLast((p) => p.type === 'data-citations') as {
    data: { final: boolean; citations: Citation[] };
  };
  return { citations: part.data.citations, final: part.data.final, reads, logs };
}

describe('Alıntı denetimi: data-citations final durumları', () => {
  it('kaynak metninde geçen alıntı (tipografik tırnak) verified kalır', async () => {
    const r = await runScenario('dogru_alinti', { snippet: null, failRead: false });
    expect(r.final).toBe(true);
    expect(r.citations.map((c) => `${c.ref}:${c.status}`)).toEqual(['K1:verified']);
  });

  it('kaynakta olmayan alıntı out_of_context + quote_mismatch olur, engellemez; log içeriksizdir', async () => {
    const r = await runScenario('yanlis_alinti', { snippet: null, failRead: false });
    expect(r.citations).toHaveLength(1);
    expect(r.citations[0]).toMatchObject({
      ref: 'K1',
      status: 'out_of_context',
      reason: 'quote_mismatch',
      blocking: 'none',
    });
    // Arama sonrası sunucu okuması tam metni belleğe aldı: ek yeniden getirme yok.
    expect(r.reads).toEqual(['1000001']);
    const all = r.logs.join('\n');
    expect(all).toContain('chat.citation.quote_check');
    expect(all).not.toContain('tanık beyanıyla');
    expect(all).not.toContain('yazılı delille');
  });

  it('yalnız özet görülmüş kararda tek yeniden getirme yapılır ve uyuşmazlık kanıtlanır', async () => {
    const r = await runScenario('yanlis_alinti', { snippet: 'Kısa özet.', failRead: false });
    expect(r.reads).toEqual(['1000001']);
    expect(r.citations[0]).toMatchObject({ status: 'out_of_context', reason: 'quote_mismatch' });
  });

  it('kaynağa ulaşılamazsa kanıt yoktur: durum değişmez (yanlış alarm yok)', async () => {
    const r = await runScenario('yanlis_alinti', { snippet: 'Kısa özet.', failRead: true });
    expect(r.reads).toEqual(['1000001']);
    expect(r.citations.map((c) => `${c.ref}:${c.status}`)).toEqual(['K1:verified']);
  });

  it('alıntısız atıfta davranış değişmez ve yeniden getirme yapılmaz', async () => {
    const r = await runScenario('alintisiz', { snippet: 'Kısa özet.', failRead: false });
    expect(r.reads).toEqual([]);
    expect(r.citations.map((c) => `${c.ref}:${c.status}`)).toEqual(['K1:verified']);
    expect(r.citations[0]?.reason).toBeUndefined();
  });
});
