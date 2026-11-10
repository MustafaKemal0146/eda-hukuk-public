// @tk TK-28
//  sohbet turunda platform ortak anahtarı (mock sağlayıcı, ağsız): kaynak `platform` olan tur kapıdan
// geçer, akış meta verisinde `keySource` taşır ve kullanım tur sonunda yazılır; kapı reddederse tur başlamaz
// (açık, Türkçe, düzeltici hata); kapı yoksa fail-closed; büro/kullanıcı anahtarı turu platform sayılmaz.
import { AiCatalog, createGateway, loadBundledFixture, type SourceBackend } from '@eda/ai';
import { AppError } from '@eda/contracts/errors';
import { AI_CATALOG_SEED } from '@eda/db/ai-catalog';
import { createLogger } from '@eda/observability/logger';
import { describe, expect, it } from 'vitest';
import { createAppSurface } from '../src/app.ts';
import { ActiveTurns, MemoryChatPersistence } from '../src/chat/persistence.ts';
import type { ChatDeps } from '../src/chat/turn.ts';
import { createReadiness } from '../src/health/ready.ts';
import { uuidv7 } from '../src/middleware/request-id.ts';
import type { PlatformKeyGate, PlatformTurnUsage } from '../src/services/ai-keys/platform-gate.ts';

const silent = { write: () => undefined };
const backend: SourceBackend = {
  searchDecisions: async () => ({ results: [], hasMore: false, stale: false }),
  getDecision: async () => {
    throw new Error('ağ yok');
  },
  searchLegislation: async () => ({ results: [] }),
  getLegislationArticles: async () => {
    throw new Error('ağ yok');
  },
};
const KEY = `sk-ant-test-${'P'.repeat(30)}plat`;

function surface(extra: Partial<ChatDeps>, betaNotice = false) {
  const logger = createLogger({ service: 'eda-api-test', destination: silent });
  const ready = createReadiness({
    probes: [],
    cacheMs: 0,
    version: 'test',
    state: { draining: false },
  });
  const mock = createGateway({
    catalog: AiCatalog.parse(AI_CATALOG_SEED),
    env: { edaEnv: 'test', mockLlm: true, devRealLlm: null },
    secrets: { deepseekApiKey: null, pseudonymKey: new Uint8Array(32) },
    loadFixture: loadBundledFixture,
  });
  // Anahtar çözümü yalnız gerçek (mock olmayan) kipte çalışır: mock modeli korurken `usesMock` kapatılır.
  const gateway = {
    ...mock,
    usesMock: () => false,
    ...(betaNotice
      ? {
          plan: ((...a: Parameters<typeof mock.plan>) => {
            const p = mock.plan(...a);
            return { ...p, badge: { ...p.badge, notices: ['beta_synthetic' as const] } };
          }) as typeof mock.plan,
        }
      : {}),
  };
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
      ...extra,
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

async function run(app: ReturnType<typeof surface>) {
  const created = await app.request('/api/v1/conversations', { method: 'POST' });
  const { id } = (await created.json()) as { id: string };
  return app.request(`/api/v1/conversations/${id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(turnBody('Tahliye taahhüdü nedir?')),
  });
}

async function sse(res: Response): Promise<Record<string, unknown>[]> {
  return (await res.text())
    .split('\n\n')
    .filter((b) => b.startsWith('data: ') && !b.includes('[DONE]'))
    .map((b) => JSON.parse(b.slice(6)) as Record<string, unknown>);
}

function recorder(deny?: AppError) {
  const events: string[] = [];
  const finished: PlatformTurnUsage[] = [];
  const started: Parameters<PlatformKeyGate['begin']>[1][] = [];
  const gate: PlatformKeyGate = {
    begin: async (_actor, start) => {
      started.push(start);
      if (deny) throw deny;
      events.push('begin');
      return {
        finish: async (u) => {
          events.push('finish');
          finished.push(u);
        },
      };
    },
  };
  return { gate, events, finished, started };
}

describe('AS-0409: sohbet turu ve platform ortak anahtarı', () => {
  it('kaynak platform: kapı çalışır, akış meta verisi keySource=platform taşır, kullanım tur sonunda yazılır', async () => {
    const r = recorder();
    const app = surface({
      resolveApiKey: async () => ({ apiKey: KEY, source: 'platform' }),
      platformKey: r.gate,
    });
    const res = await run(app);
    expect(res.status).toBe(200);
    const parts = await sse(res);
    const start = parts.find((p) => p.type === 'start') as {
      messageMetadata?: { keySource?: string };
    };
    expect(start.messageMetadata?.keySource).toBe('platform');
    expect(JSON.stringify(parts)).not.toContain(KEY);
    expect(r.events).toEqual(['begin', 'finish']);
    expect(r.finished[0]).toMatchObject({ status: 'success' });
    expect(r.started[0]).toMatchObject({ modelAlias: 'edai-flash' });
  });

  it('limit aşımı: tur başlamaz, 429 açık Türkçe düzeltici hata; kullanım yazılmaz', async () => {
    const r = recorder(
      new AppError('QUOTA_DAILY_COST_CAP', {
        reason: 'platform_key_user_day',
        meta: { retryAfterSec: 3600 },
      }),
    );
    const app = surface({
      resolveApiKey: async () => ({ apiKey: KEY, source: 'platform' }),
      platformKey: r.gate,
    });
    const res = await run(app);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; reason: string; message: string } };
    expect(body.error).toMatchObject({
      code: 'QUOTA_DAILY_COST_CAP',
      reason: 'platform_key_user_day',
    });
    expect(body.error.message).toContain('kendi anahtarınızı ekleyin');
    expect(body.error.message).toContain('yarın tekrar deneyin');
    expect(r.events).toEqual([]);
  });

  it('D-1: kota reddinden sonra sohbet kilitli kalmaz: yeni tur kabul edilir ve sohbet silinebilir', async () => {
    let deny = true;
    const events: string[] = [];
    const gate: PlatformKeyGate = {
      begin: async () => {
        if (deny) {
          throw new AppError('QUOTA_DAILY_COST_CAP', {
            reason: 'platform_key_platform_day',
            meta: { retryAfterSec: 3600 },
          });
        }
        return { finish: async () => void events.push('finish') };
      },
    };
    const active = new ActiveTurns();
    const app = surface({
      resolveApiKey: async () => ({ apiKey: KEY, source: 'platform' }),
      platformKey: gate,
      active,
    });
    const created = await app.request('/api/v1/conversations', { method: 'POST' });
    const { id } = (await created.json()) as { id: string };
    const send = () =>
      app.request(`/api/v1/conversations/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(turnBody('Tahliye taahhüdü nedir?')),
      });
    expect((await send()).status).toBe(429);
    expect(active.get(id)).toBeUndefined();
    // Ret tekrarlansa da CHAT_STREAM_IN_PROGRESS (409) olmaz.
    expect((await send()).status).toBe(429);
    deny = false;
    const ok = await send();
    expect(ok.status).toBe(200);
    await ok.text();
    expect(events).toEqual(['finish']);
    const del = await app.request(`/api/v1/conversations/${id}`, { method: 'DELETE' });
    expect(del.status).toBeLessThan(300);
  });

  it('KK-pilot-3: pilot bildirimi gerçek müvekkil bilgisi girilmemesini söyler', async () => {
    const app = surface({ resolveApiKey: async () => ({ apiKey: KEY, source: 'org' }) }, true);
    const parts = await sse(await run(app));
    const notice = parts.find((p) => p.id === 'notice:beta_synthetic') as {
      data?: { code?: string; message?: string };
    };
    expect(notice.data?.code).toBe('beta_synthetic');
    expect(notice.data?.message).toBe(
      'Pilot sürüm: gerçek müvekkil bilgisi girmeyin; yalnız sentetik (uydurma) veri kullanın.',
    );
  });

  it('kaynak platform ama kapı yok: fail-closed (409 AI_POLICY_NO_PROVIDER), sağlayıcıya gidilmez', async () => {
    const app = surface({ resolveApiKey: async () => ({ apiKey: KEY, source: 'platform' }) });
    const res = await run(app);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'AI_POLICY_NO_PROVIDER',
    );
  });

  it('büro/kullanıcı anahtarı turu kapıdan geçmez ve keySource org/own olur', async () => {
    for (const source of ['org', 'own'] as const) {
      const r = recorder();
      const app = surface({
        resolveApiKey: async () => ({ apiKey: KEY, source }),
        platformKey: r.gate,
      });
      const res = await run(app);
      expect(res.status).toBe(200);
      const parts = await sse(res);
      const start = parts.find((p) => p.type === 'start') as {
        messageMetadata?: { keySource?: string };
      };
      expect(start.messageMetadata?.keySource).toBe(source);
      expect(r.events).toEqual([]);
    }
  });

  it('anahtar eksik: eski davranış (org_key_missing), platform kapısı çağrılmaz', async () => {
    const r = recorder();
    const app = surface({ resolveApiKey: async () => ({ missing: 'org' }), platformKey: r.gate });
    const res = await run(app);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { reason: string } }).error.reason).toBe(
      'org_key_missing',
    );
    expect(r.events).toEqual([]);
  });
});
