// @tk TK-28
// Sohbet dikey dilimi (022 §2, §5): mock sağlayıcıyla uçtan uca tur. SSE akışı yalnız kanonik
// parçaları taşır (araç parçası yok), data-pipeline geçicidir, [K#] etiketleri kaynaklarla eşleşir.
import { AiCatalog, createGateway, loadBundledFixture, type SourceBackend } from '@eda/ai';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { createAppSurface } from '../src/app.ts';
import { ActiveTurns, MemoryChatPersistence } from '../src/chat/persistence.ts';
import { createReadiness } from '../src/health/ready.ts';
import { uuidv7 } from '../src/middleware/request-id.ts';

const silent = { write: () => undefined };

const backend: SourceBackend = {
  searchDecisions: async () => ({
    results: [
      {
        source: 'bedesten',
        document_id: '1000001',
        court_type: 'yargitay',
        court: 'Yargıtay',
        chamber: '3. Hukuk Dairesi',
        esas_no: '2024/100',
        karar_no: '2025/200',
        decision_date: '2025-01-02',
        title: 't',
        snippet: null,
        url: 'https://mevzuat.adalet.gov.tr/ictihat/1000001',
        retrieved_at: '2026-10-10',
      },
    ],
    hasMore: false,
    stale: false,
  }),
  getDecision: async () => {
    throw new Error('ağ yok');
  },
  searchLegislation: async () => ({ results: [] }),
  getLegislationArticles: async () => ({
    law_no: '6098',
    law_name: 'Türk Borçlar Kanunu',
    url: 'https://www.mevzuat.gov.tr/MevzuatMetin/1.5.6098.pdf',
    retrieved_at: '2026-10-10',
    last_amended_at: null,
    articles: [{ article_no: '352', heading: null, markdown: 'Kiracı…', repealed: false }],
  }),
};

function surface() {
  const logger = createLogger({ service: 'eda-api-test', destination: silent });
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
    loadFixture: loadBundledFixture,
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
      backend,
      persistence: new MemoryChatPersistence(),
      active: new ActiveTurns(),
      pseudonymKey: new Uint8Array(32),
      logger,
      allowScenarioPrefix: true,
      uuid: () => uuidv7(),
    },
  }).app;
}

function turnBody(text: string) {
  return {
    trigger: 'submit-message',
    message: { id: uuidv7(), role: 'user', parts: [{ type: 'text', text }] },
    regenerateMessageId: null,
    alias: 'edai-flash',
    mode: 'chat',
    scope: { sources: [], chamber: null, dateFrom: null, dateTo: null },
    attachments: [],
    mentions: [],
    documentId: null,
    documentBaseVersion: null,
    liveSearch: false,
  };
}

async function sse(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('data: ') && !b.includes('[DONE]'))
    .map((b) => JSON.parse(b.slice(6)) as Record<string, unknown>);
}

describe('Sohbet dikey dilimi (mock)', () => {
  it('sohbet oluşturur, araçlı tur akar, kaynaklar ve künyeler eşleşir', async () => {
    const app = surface();
    const created = await app.request('/api/v1/conversations', { method: 'POST' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const res = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        turnBody('/senaryo chat_tool_search Tahliye taahhüdü ne zaman geçerli?'),
      ),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1');
    const parts = await sse(res);
    const types = parts.map((p) => p.type as string);
    expect(types[0]).toBe('start');
    expect(types.filter((t) => t.startsWith('tool-'))).toEqual([]);
    expect(types).toContain('data-pipeline');
    expect(types).toContain('data-sources');
    expect(types.at(-1)).toBe('finish');
    // Her kaynak getirildiği anı (fetchedAt, ISO 8601) taşır; arayüz erişim tarihini buradan yazar.
    const sourcesPart = parts.findLast((p) => p.type === 'data-sources') as {
      data: { sources: { ref: string; portal?: string; fetchedAt?: string }[] };
    };
    expect(sourcesPart.data.sources.length).toBeGreaterThan(0);
    for (const s of sourcesPart.data.sources) {
      expect(s.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      expect(Number.isNaN(Date.parse(s.fetchedAt ?? ''))).toBe(false);
    }
    expect(sourcesPart.data.sources[0]?.portal).toBe('bedesten');
    const notice = parts.find((p) => p.type === 'data-notice') as { data: { code: string } };
    expect(notice.data.code).toBe('simulation');
    const citations = parts.findLast((p) => p.type === 'data-citations') as {
      data: { citations: { ref: string; status: string }[] };
    };
    expect(citations.data.citations.map((c) => `${c.ref}:${c.status}`)).toEqual(['K1:verified']);
    const conv = await app.request(`/api/v1/conversations/${id}`);
    const body = (await conv.json()) as { messages: { role: string }[] };
    expect(body.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('KK-022-S3: kişisel veri içeren mesajda masking_applied (meta.count) yayılır, sade mesajda yok', async () => {
    const app = surface();
    const turn = async (text: string) => {
      const created = await app.request('/api/v1/conversations', { method: 'POST' });
      const { id } = (await created.json()) as { id: string };
      const res = await app.request(`/api/v1/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(turnBody(text)),
      });
      expect(res.status).toBe(200);
      return (await sse(res)).filter((p) => p.type === 'data-notice') as {
        data: { code: string; message: string; meta?: { count?: number } };
      }[];
    };
    // Sentetik, algoritmaca geçerli TCKN ve uydurma telefon (gerçek kişiye ait değildir).
    const masked = await turn(
      '/senaryo chat_tool_search Müvekkil T.C. 10000000146, tel 0532 111 22 33; işe iade süresi?',
    );
    const notice = masked.find((n) => n.data.code === 'masking_applied');
    expect(notice?.data.meta?.count).toBeGreaterThanOrEqual(2);
    expect(notice?.data.message).toBe(`${notice?.data.meta?.count} kişisel veri maskelendi.`);
    expect(JSON.stringify(notice)).not.toContain('10000000146');

    const plain = await turn('/senaryo chat_tool_search Tahliye taahhüdü ne zaman geçerli?');
    expect(plain.map((n) => n.data.code)).not.toContain('masking_applied');
  });

  it('sohbeti siler: 204, sonra 404; listeden düşer; bilinmeyen sohbet 404', async () => {
    const app = surface();
    const created = await app.request('/api/v1/conversations', { method: 'POST' });
    const { id } = (await created.json()) as { id: string };
    const turn = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        turnBody('/senaryo chat_tool_search Tahliye taahhüdü ne zaman geçerli?'),
      ),
    });
    await sse(turn);
    const before = (await (await app.request('/api/v1/conversations')).json()) as {
      items: { id: string }[];
    };
    expect(before.items.map((c) => c.id)).toContain(id);

    const del = await app.request(`/api/v1/conversations/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(await del.text()).toBe('');

    expect((await app.request(`/api/v1/conversations/${id}`)).status).toBe(404);
    const after = (await (await app.request('/api/v1/conversations')).json()) as {
      items: { id: string }[];
    };
    expect(after.items.map((c) => c.id)).not.toContain(id);

    // İkinci silme ve hiç olmayan kimlik: 404 zarfı.
    expect((await app.request(`/api/v1/conversations/${id}`, { method: 'DELETE' })).status).toBe(
      404,
    );
    expect(
      (await app.request(`/api/v1/conversations/${uuidv7()}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect((await app.request('/api/v1/conversations/gecersiz', { method: 'DELETE' })).status).toBe(
      404,
    );
  });

  it('bilinmeyen sohbet 404 zarf; geçersiz gövde 422', async () => {
    const app = surface();
    const missing = await app.request(`/api/v1/conversations/${uuidv7()}`);
    expect(missing.status).toBe(404);
    const created = await app.request('/api/v1/conversations', { method: 'POST' });
    const { id } = (await created.json()) as { id: string };
    const bad = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ trigger: 'submit-message' }),
    });
    expect(bad.status).toBe(422);
  });

  it('yeniden üretir: aynı kullanıcı mesajıyla yeni tur; yanıt yerinde güncellenir', async () => {
    const app = surface();
    const created = await app.request('/api/v1/conversations', { method: 'POST' });
    const { id } = (await created.json()) as { id: string };
    const first = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        turnBody('/senaryo chat_tool_search Tahliye taahhüdü ne zaman geçerli?'),
      ),
    });
    const firstParts = await sse(first);
    const firstAssistantId = (firstParts[0] as { messageId?: string }).messageId ?? '';
    expect(firstAssistantId).not.toBe('');

    const read = async (): Promise<{ id: string; role: string }[]> => {
      const res = await app.request(`/api/v1/conversations/${id}`);
      const body = (await res.json()) as { messages: { id: string; role: string }[] };
      return body.messages;
    };
    const before = await read();
    expect(before.map((m) => m.role)).toEqual(['user', 'assistant']);
    const userId = before[0]?.id ?? '';

    const regen = await app.request(`/api/v1/conversations/${id}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...turnBody('yeniden üretim'),
        trigger: 'regenerate-message',
        message: null,
        regenerateMessageId: firstAssistantId,
      }),
    });
    expect(regen.status).toBe(200);
    const regenParts = await sse(regen);
    // Yerinde güncelleme: yanıt kimliği korunur, istemci eşleşmesi bozulmaz.
    expect((regenParts[0] as { messageId?: string }).messageId).toBe(firstAssistantId);

    const after = await read();
    // Yanıt üzerine yazılmıştır; kullanıcı mesajı yinelenmez ve sohbet ilerlemez.
    expect(after.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(after[0]?.id).toBe(userId);
    expect(after[1]?.id).toBe(firstAssistantId);
  });

  it('mesaj düzenleme: hedef ve sonrası kesilir, yeni metin yeni tur olarak yazılır', async () => {
    const app = surface();
    const created = await app.request('/api/v1/conversations', { method: 'POST' });
    const { id } = (await created.json()) as { id: string };
    const post = (body: Record<string, unknown>) =>
      app.request(`/api/v1/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const read = async (): Promise<{ id: string; role: string; parts: { text?: string }[] }[]> => {
      const res = await app.request(`/api/v1/conversations/${id}`);
      const body = (await res.json()) as {
        messages: { id: string; role: string; parts: { text?: string }[] }[];
      };
      return body.messages;
    };
    await sse(await post(turnBody('/senaryo chat_tool_search Tahliye taahhüdü ne zaman geçerli?')));
    await sse(await post(turnBody('/senaryo chat_tool_search İkinci soru?')));
    const before = await read();
    expect(before.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const firstUser = before[0]?.id ?? '';
    const secondUser = before[2]?.id ?? '';

    // İkinci kullanıcı mesajı düzenlenir: o mesaj ve yanıtı düşer, yeni metin yeni tur olur.
    const edited = turnBody('/senaryo chat_tool_search Düzeltilmiş ikinci soru?');
    const res = await post({ ...edited, replaceFromMessageId: secondUser });
    expect(res.status).toBe(200);
    await sse(res);
    const after = await read();
    expect(after.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(after[0]?.id).toBe(firstUser);
    expect(after[2]?.id).toBe(edited.message.id);
    expect(after[2]?.id).not.toBe(secondUser);
    expect(after[2]?.parts[0]?.text).toBe('Düzeltilmiş ikinci soru?');

    // Hedef asistan yanıtı veya bilinmeyen kimlik olamaz: tur başlamaz.
    expect((await post({ ...turnBody('x'), replaceFromMessageId: after[1]?.id })).status).toBe(422);
    expect((await post({ ...turnBody('x'), replaceFromMessageId: uuidv7() })).status).toBe(422);
    expect((await read()).map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);

    // İlk mesaj düzenlenince sohbet baştan başlar.
    const fresh = turnBody('/senaryo chat_tool_search Baştan soru?');
    await sse(await post({ ...fresh, replaceFromMessageId: firstUser }));
    const restarted = await read();
    expect(restarted.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(restarted[0]?.id).toBe(fresh.message.id);
  });

  it('yeniden üretim yalnız son yanıtı hedefler: yanıtsız veya yanlış kimlik 422', async () => {
    const app = surface();
    const created = await app.request('/api/v1/conversations', { method: 'POST' });
    const { id } = (await created.json()) as { id: string };
    const post = (body: Record<string, unknown>) =>
      app.request(`/api/v1/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    const regenerateBody = (regenerateMessageId: string | null) => ({
      ...turnBody('x'),
      trigger: 'regenerate-message',
      message: null,
      regenerateMessageId,
    });
    // Yanıtsız sohbette hedef yoktur.
    expect((await post(regenerateBody(null))).status).toBe(422);

    // Akış tüketilmezse etkin tur kaydı açık kalır; yanıt okunur.
    await sse(await post(turnBody('/senaryo chat_tool_search Tahliye taahhüdü ne zaman geçerli?')));
    // Var olan ama son olmayan/başka bir kimlik hedef olamaz.
    expect((await post(regenerateBody(uuidv7()))).status).toBe(422);
  });
});
