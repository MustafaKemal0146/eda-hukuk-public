// @tk TK-04 TK-05
// P27 "Sohbetler ve raporlar" servis ve rota birimi (ağsız; sahte veritabanı). Sahte fonksiyon satırlarına
// bilerek içerik ve kimlik kolonları katılır: servis yalnız tanımlı sayaç alanlarını okur, çıktı şemadan
// geçer; yanıt gövdesinde işaret dizgisi ASLA bulunmaz (KK-P27-chat-3).
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createChatReportsService } from '../src/admin/chat-reports-service.ts';
import type { AdminDb } from '../src/admin/db.ts';
import { mountAdminChatReports } from '../src/admin/routes/chat-reports.ts';
import type { SurfaceEnv } from '../src/context/types.ts';
import { errorHandler } from '../src/errors/error-handler.ts';
import { requestId } from '../src/middleware/request-id.ts';
import { RouteRegistry } from '../src/routing/route-registry.ts';

const MARKER = `GIZLI-ISARET-${randomUUID()}`;
const USER_ID = randomUUID();
const ORG_ID = randomUUID();

const dailyRow = {
  day: '2026-10-01',
  conversations: 2,
  messages: 9,
  user_messages: 4,
  turns: 5,
  turns_error: 1,
  avg_turn_seconds: '12.5',
  active_orgs: 1,
  chat_calls: 5,
  petition_calls: 1,
  sources_decision: 3,
  sources_legislation: 2,
  feedback_up: 1,
  feedback_down: 1,
  // Sızıntı denemesi: fonksiyon çıktısına yanlışlıkla eklenmiş içerik/kimlik kolonları.
  title: MARKER,
  user_id: USER_ID,
  org_id: ORG_ID,
};

const breakdownRows = [
  { dimension: 'mode', key: 'chat', total: '5', errors: '0', avg_ms: 0, title: MARKER },
  { dimension: 'mode', key: 'petition', total: '1', errors: '0', avg_ms: 0 },
  { dimension: 'model_alias', key: 'edai-flash', total: '4', errors: '1', avg_ms: 0 },
  { dimension: 'tool', key: 'get_decision', total: '10', errors: '2', avg_ms: 220 },
  { dimension: 'source_kind', key: 'decision', total: '3', errors: '0', avg_ms: 0 },
  { dimension: 'source_origin', key: 'corpus', total: '3', errors: '0', avg_ms: 0 },
  { dimension: 'feedback_rating', key: 'up', total: '1', errors: '0', avg_ms: 0 },
  { dimension: 'feedback_rating', key: 'down', total: '1', errors: '0', avg_ms: 0 },
  { dimension: 'feedback_category', key: 'incorrect', total: '1', errors: '0', avg_ms: 0 },
  { dimension: 'org_kind', key: 'firm', total: '2', errors: '0', avg_ms: 0 },
];

function fakeDb(opts: { code?: string } = {}): { db: AdminDb; calls: string[] } {
  const calls: string[] = [];
  const tx = {
    query: async (sql: string) => {
      calls.push(sql);
      if (opts.code !== undefined) throw Object.assign(new Error('x'), { code: opts.code });
      return { rows: sql.includes('daily') ? [dailyRow] : breakdownRows };
    },
  };
  const db = { withAdmin: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as never;
  return { db, calls };
}

function app(opts: { code?: string; user?: boolean } = {}) {
  const { db, calls } = fakeDb(opts.code === undefined ? {} : { code: opts.code });
  const a = new Hono<SurfaceEnv>();
  a.use('*', requestId());
  a.use('*', async (c, next) => {
    if (opts.user !== false) c.set('user', { id: randomUUID() } as never);
    await next();
  });
  const registry = new RouteRegistry();
  mountAdminChatReports(a, registry, createChatReportsService({ db }));
  a.onError(
    errorHandler({
      surface: 'admin',
      logger: { error: () => undefined, warn: () => undefined, info: () => undefined } as never,
    }),
  );
  return { a, registry, calls };
}

const URL_OK = 'http://x/api/v1/admin/chat-reports?from=2026-10-01&to=2026-10-02';

describe('KK-P27-chat-1: rota meta ve aralık', () => {
  it('rota platform:usage_read ister, stepUp istemez, yalnız GET kayıtlı (indirme ucu yok)', () => {
    const { registry } = app();
    const routes = registry.list();
    expect(routes.map((r) => `${r.method} ${r.path}`)).toEqual(['GET /api/v1/admin/chat-reports']);
    expect(routes[0]?.meta.permission).toBe('platform:usage_read');
    expect(routes[0]?.meta.stepUp).toBe(false);
  });

  it('92 günü aşan, ters ve ek parametreli istekler 422; sahte veritabanına hiç dokunmaz', async () => {
    const { a, calls } = app();
    for (const q of [
      'from=2025-01-01&to=2026-10-02',
      'from=2026-10-05&to=2026-10-01',
      'from=2026-10-01&to=2026-10-02&format=csv',
      'from=bozuk&to=2026-10-02',
    ]) {
      const r = await a.request(`http://x/api/v1/admin/chat-reports?${q}`);
      expect(r.status, q).toBe(422);
    }
    expect(calls).toEqual([]);
  });

  it('veritabanı 42501 verirse 403, 22023 verirse 422', async () => {
    expect((await app({ code: '42501' }).a.request(URL_OK)).status).toBe(403);
    expect((await app({ code: '22023' }).a.request(URL_OK)).status).toBe(422);
  });
});

describe('KK-P27-chat-3: içerik ve kimlik sızıntısı yok', () => {
  it('sahte satırlardaki içerik/kimlik kolonları yanıta geçmez; sayılar doğru toplanır', async () => {
    const { a } = app();
    const res = await a.request(URL_OK);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const text = await res.text();
    for (const secret of [MARKER, 'GIZLI-ISARET', USER_ID, ORG_ID]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(text).not.toMatch(/"(title|userId|orgId|user_id|org_id|email|parts)"/);
    const j = JSON.parse(text) as {
      daily: { turns: number; avgTurnSeconds: number | null }[];
      tools: { tool: string; errorRate: number; avgDurationMs: number }[];
      feedback: { up: number; down: number };
      modes: { mode: string; calls: number }[];
      unavailable: string[];
    };
    expect(j.daily[0]?.turns).toBe(5);
    expect(j.daily[0]?.avgTurnSeconds).toBe(12.5);
    expect(j.tools[0]).toMatchObject({ tool: 'get_decision', errorRate: 0.2, avgDurationMs: 220 });
    expect(j.feedback).toMatchObject({ up: 1, down: 1 });
    expect(j.modes).toHaveLength(2);
    expect(j.unavailable).toEqual(['masking_notices']);
  });

  it('beklenmeyen kod değeri (ör. içerik taşıyan anahtar) sızıntı yerine hata üretir', async () => {
    const { db } = fakeDb();
    const svc = createChatReportsService({
      db: {
        withAdmin: async (fn: never) =>
          (fn as (t: unknown) => unknown)({
            query: async (sql: string) => ({
              rows: sql.includes('daily')
                ? [dailyRow]
                : [{ dimension: 'tool', key: MARKER, total: 1, errors: 0, avg_ms: 0 }],
            }),
          }),
      } as never,
    });
    void db;
    await expect(svc.report(randomUUID(), '2026-10-01', '2026-10-02')).rejects.toThrow();
  });
});
