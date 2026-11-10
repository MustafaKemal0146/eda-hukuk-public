// @tk TK-13 TK-28
// P21 ilk dilimi: sohbet eki turu (mock sağlayıcı). Modele giden mesajda ek metni
// `<kaynak_verisi tur="evrak">` içinde ve `attachment` kökenli ayrı parçada; evrak adı sağlayıcıya
// gitmez (yalnız UI `title`); ek `[K#]` kaynağı `case_file` + köken `user`; kullanıcı mesajında `file`
// parçası (bayt yok); yeniden üretimde ek bağlamı yeniden kurulur; çözücü hatası sağlayıcıyı çağırmaz.
import { AiCatalog, createGateway, type Gateway, loadBundledFixture } from '@eda/ai';
import { AppError } from '@eda/contracts/errors';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';
import { createLogger } from '@eda/observability/logger';
import type { ModelMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import { createAppSurface } from '../src/app.ts';
import { ActiveTurns, MemoryChatPersistence } from '../src/chat/persistence.ts';
import { createReadiness } from '../src/health/ready.ts';
import { uuidv7 } from '../src/middleware/request-id.ts';
import type { ChatAttachments, ResolvedAttachment } from '../src/services/chat/attachments.ts';

const silent = { write: () => undefined };
const FILE_ID = '01990000-0000-7000-8000-0000000000a1';
const NAME = 'GIZLI-AD-kira-sozlesmesi.pdf';
const KIRA_TEXT =
  'ÖRNEK İŞYERİ KİRA SÖZLEŞMESİ\nMadde 2 - Kira bedeli: Aylık kira bedeli 27.500 TL olup her ayın beşinci gününe kadar ödenir.\n\nMadde 7 - Fesih: üç ay önceden yazılı bildirim.';

const attachment: ResolvedAttachment = {
  fileId: FILE_ID,
  name: NAME,
  fileType: 'pdf',
  mimeType: 'application/pdf',
  text: KIRA_TEXT,
  pageCount: 2,
  pageOffsets: [0, 120],
  uploadedOn: '2026-10-17',
};

interface Captured {
  messages: ModelMessage[];
  masked: string;
}

function surface(port: ChatAttachments | undefined) {
  const logger = createLogger({ service: 'eda-api-test', destination: silent });
  const real = createGateway({
    catalog: AiCatalog.parse(AI_CATALOG_SEED),
    env: { edaEnv: 'test', mockLlm: true, devRealLlm: null },
    secrets: { deepseekApiKey: null, pseudonymKey: new Uint8Array(32) },
    loadFixture: loadBundledFixture,
  });
  const captured: Captured[] = [];
  const plans: string[][] = [];
  // Casus geçit: gerçek mock geçidine devreder; modele giden mesajları ve maskeleyicinin sağlayıcıya
  // göndereceği son kullanıcı mesajını kaydeder.
  const gateway: Gateway = {
    usesMock: () => real.usesMock(),
    plan: (input) => {
      plans.push([...input.gate.origins]);
      return real.plan(input);
    },
    streamTurn: (input, candidate) => {
      const last = input.messages.at(-1);
      const content =
        last && typeof last.content !== 'string' && Array.isArray(last.content)
          ? last.content
          : [{ type: 'text', text: String(last?.content ?? '') }];
      const prompt = [{ role: 'user', content }] as unknown as Parameters<
        typeof input.masker.mask
      >[0];
      captured.push({
        messages: input.messages,
        masked: JSON.stringify(input.masker.mask(prompt).prompt),
      });
      return real.streamTurn(input, candidate);
    },
  };
  const ready = createReadiness({
    probes: [],
    cacheMs: 0,
    version: 'test',
    state: { draining: false },
  });
  const app = createAppSurface({
    surface: 'app',
    logger,
    state: { draining: false },
    maintenanceMode: () => false,
    jsonBodyMaxBytes: 1024 * 1024,
    ready,
    chat: {
      gateway,
      backend: {
        searchDecisions: async () => ({ results: [], hasMore: false, stale: false }),
        getDecision: async () => {
          throw new Error('ağ yok');
        },
        searchLegislation: async () => ({ results: [] }),
        getLegislationArticles: async () => {
          throw new Error('ağ yok');
        },
      },
      persistence: new MemoryChatPersistence(),
      active: new ActiveTurns(),
      pseudonymKey: new Uint8Array(32),
      logger,
      allowScenarioPrefix: true,
      ...(port === undefined ? {} : { attachments: port }),
      uuid: () => uuidv7(),
    },
  }).app;
  return { app, captured, plans };
}

function body(text: string, attachments: string[], over: Record<string, unknown> = {}) {
  return {
    trigger: 'submit-message',
    message: { id: uuidv7(), role: 'user', parts: [{ type: 'text', text }] },
    regenerateMessageId: null,
    alias: 'edai-flash',
    mode: 'chat',
    scope: { sources: [], chamber: null, dateFrom: null, dateTo: null },
    attachments,
    mentions: [],
    documentId: null,
    documentBaseVersion: null,
    liveSearch: false,
    ...over,
  };
}

async function sse(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('data: ') && !b.includes('[DONE]'))
    .map((b) => JSON.parse(b.slice(6)) as Record<string, unknown>);
}

async function newConversation(app: ReturnType<typeof surface>['app']): Promise<string> {
  const created = await app.request('/api/v1/conversations', { method: 'POST' });
  return ((await created.json()) as { id: string }).id;
}

const post = (app: ReturnType<typeof surface>['app'], id: string, b: unknown) =>
  app.request(`/api/v1/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(b),
  });

describe('KK-P21-dosya: sohbet eki turu', () => {
  it('ek metni modele giden bağlamda, evrak sarmalayıcısında; ad sağlayıcıya gitmez; kaynak case_file', async () => {
    const calls: string[][] = [];
    const port: ChatAttachments = {
      resolveBound: async () => [],
      resolve: async (_actor, _conv, ids) => {
        calls.push([...ids]);
        return [attachment];
      },
    };
    const { app, captured, plans } = surface(port);
    const id = await newConversation(app);
    const res = await post(app, id, body('Aylık kira bedeli ne kadar?', [FILE_ID]));
    expect(res.status).toBe(200);
    const parts = await sse(res);
    expect(calls).toEqual([[FILE_ID]]);
    expect(plans.at(-1)).toEqual(['user_text', 'attachment']);

    const last = captured.at(-1)?.messages.at(-1);
    expect(last?.role).toBe('user');
    const content = last?.content as { type: string; text: string; providerOptions?: unknown }[];
    expect(content[0]?.providerOptions).toEqual({ eda: { origin: 'attachment' } });
    expect(content[0]?.text).toContain('<kaynak_verisi id="K1" tur="evrak" guvenilir="hayir">');
    expect(content[0]?.text).toContain('27.500 TL');
    expect(content[1]?.text).toContain('K1: Ek 1 (PDF, 2 sayfa) (evrak)');
    expect(content[1]?.text).toContain('Aylık kira bedeli ne kadar?');
    // Maskeleyiciden geçen (sağlayıcıya gidecek) biçimde de yanıt metni var; evrak adı hiçbir yerde yok.
    expect(captured.at(-1)?.masked).toContain('27.500 TL');
    expect(JSON.stringify(captured.at(-1)?.messages)).not.toContain('GIZLI-AD');

    const sources = parts.find((p) => p.type === 'data-sources') as {
      data: {
        sources: { ref: string; kind: string; origin: string; title: string; portal?: string }[];
      };
    };
    expect(sources.data.sources[0]).toMatchObject({
      ref: 'K1',
      kind: 'case_file',
      origin: 'user',
      title: NAME,
    });
    expect(sources.data.sources[0]?.portal).toBeUndefined();

    const conv = (await (await app.request(`/api/v1/conversations/${id}`)).json()) as {
      messages: { role: string; parts: { type: string; url?: string; filename?: string }[] }[];
    };
    const user = conv.messages.find((m) => m.role === 'user');
    expect(user?.parts.find((p) => p.type === 'file')).toEqual({
      type: 'file',
      mediaType: 'application/pdf',
      filename: NAME,
      url: `eda-file:${FILE_ID}`,
    });
  });

  it('yeniden üretimde ek bağlamı kullanıcı mesajındaki parçadan yeniden kurulur; [K#] korunur', async () => {
    const port: ChatAttachments = {
      resolve: async () => [attachment],
      resolveBound: async () => [attachment],
    };
    const { app, captured } = surface(port);
    const id = await newConversation(app);
    await sse(await post(app, id, body('Fesih bildirimi ne zaman yapılmalı?', [FILE_ID])));
    const regen = await post(
      app,
      id,
      body('x', [], { trigger: 'regenerate-message', message: null, regenerateMessageId: null }),
    );
    expect(regen.status).toBe(200);
    await sse(regen);
    expect(captured).toHaveLength(2);
    const text = JSON.stringify(captured[1]?.messages.at(-1));
    expect(text).toContain('id=\\"K1\\" tur=\\"evrak\\"');
    expect(text).toContain('üç ay önceden');
  });

  it('çözücü hatası (işlenmekte) 409 zarfı; sağlayıcı çağrılmaz. Çözücü yoksa ekli tur 422', async () => {
    const busy: ChatAttachments = {
      resolveBound: async () => [],
      resolve: async () => {
        throw new AppError('FILE_NOT_READY', { actions: ['wait'] });
      },
    };
    const a = surface(busy);
    const id = await newConversation(a.app);
    const res = await post(a.app, id, body('Kira bedeli?', [FILE_ID]));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('FILE_NOT_READY');
    expect(a.captured).toHaveLength(0);

    const b = surface(undefined);
    const id2 = await newConversation(b.app);
    const res2 = await post(b.app, id2, body('Kira bedeli?', [FILE_ID]));
    expect(res2.status).toBe(422);
    expect(b.captured).toHaveLength(0);
  });

  it('takip sorusu: uzun ekten bu soruyla ilgili bölüm eklenir, kısa ek tekrar gönderilmez', async () => {
    const filler =
      'Dosya kapsamındaki deliller birlikte değerlendirilmiş ve tutanaklar incelenmiştir.\n';
    const long: ResolvedAttachment = {
      ...attachment,
      fileId: '01990000-0000-7000-8000-0000000000b2',
      name: 'ornek-karar.pdf',
      text: `${filler.repeat(800)}Bilirkişi raporunda hasar bedeli 184.250 TL olarak belirlenmiştir.\n${filler.repeat(800)}`,
      pageCount: 30,
      pageOffsets: [],
    };
    const bound: string[][] = [];
    const port: ChatAttachments = {
      resolve: async (_a, _c, ids) => [long, attachment].filter((x) => ids.includes(x.fileId)),
      resolveBound: async (_a, _c, ids) => {
        bound.push([...ids]);
        return [long, attachment].filter((x) => ids.includes(x.fileId));
      },
    };
    const { app, captured } = surface(port);
    const id = await newConversation(app);
    await sse(await post(app, id, body('Kararın sonucu ne?', [long.fileId, FILE_ID])));
    const follow = await sse(await post(app, id, body('Bilirkişi hasar bedeli ne kadar?', [])));
    expect(bound.at(-1)?.sort()).toEqual([FILE_ID, long.fileId].sort());
    const last = captured.at(-1)?.messages.at(-1);
    const content = last?.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain('[EKLER - EK BÖLÜMLER]');
    expect(content[0]?.text).toContain('184.250 TL');
    // Kısa ek takip turunda yeniden gönderilmez (transkriptte tam metin var).
    expect(content[0]?.text).not.toContain('27.500 TL');
    const sources = follow.find((p) => p.type === 'data-sources') as {
      data: { sources: { ref: string; title: string }[] };
    };
    expect(sources.data.sources.map((s) => s.title)).toEqual(['ornek-karar.pdf']);
  });
});
