// @tk TK-33
// #16 (P10; 053-02 §2.2, KK-053-02-4 alt kümesi): "Son sohbetler" listesi kalıcı geçmişten
// (`GET /api/v1/conversations`) gelir. Sunucunun sırası (son mesaj zamanı) KORUNUR; boş ve hata
// durumları ayrıdır, hata listeyi silmez (kenar çubuğu yanıltıcı "henüz sohbet yok" demez).
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteConversation,
  listConversations,
  readRecentConversations,
  refreshRecentConversations,
} from '../src/lib/conversations.ts';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KK-053-02-4: son sohbetler deposu', () => {
  it('sunucu sırasını korur; oluşturma zamanına göre yeniden sıralamaz', async () => {
    vi.stubGlobal('fetch', async () =>
      json({
        items: [
          {
            id: 'son-kullanilan',
            title: 'Eski ama son kullanılan',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          {
            id: 'yeni-acilan',
            title: 'Yeni ama kullanılmayan',
            createdAt: '2026-10-01T00:00:00.000Z',
          },
        ],
      }),
    );
    await refreshRecentConversations();
    const state = readRecentConversations();
    expect(state.state).toBe('ready');
    expect(state.items.map((c) => c.id)).toEqual(['son-kullanilan', 'yeni-acilan']);
  });

  it('hata durumunda önceki liste korunur ve durum error olur', async () => {
    vi.stubGlobal('fetch', async () =>
      json({ error: { code: 'INTERNAL_ERROR', message: null, requestId: null } }, 500),
    );
    await refreshRecentConversations();
    const state = readRecentConversations();
    expect(state.state).toBe('error');
    expect(state.items.map((c) => c.id)).toEqual(['son-kullanilan', 'yeni-acilan']);
  });

  it('boş liste ready ve boş dizidir', async () => {
    vi.stubGlobal('fetch', async () => json({ items: [] }));
    await refreshRecentConversations();
    expect(readRecentConversations()).toEqual({ state: 'ready', items: [] });
  });

  it('gövde daraltılır: kimliksiz öğe atılır, başlık yoksa null olur', async () => {
    vi.stubGlobal('fetch', async () =>
      json({
        items: [
          { id: 'a', title: null, createdAt: '2026-01-01T00:00:00.000Z' },
          { title: 'kimliksiz' },
          'metin',
        ],
      }),
    );
    expect(await listConversations()).toEqual([
      { id: 'a', title: null, createdAt: '2026-01-01T00:00:00.000Z' },
    ]);
  });
});

describe('sohbet silme: son sohbetler deposu', () => {
  it('silme başarılıysa DELETE gider ve sohbet listeden düşer; diğerleri kalır', async () => {
    const calls: { url: string; method: string | undefined }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      return json({
        items: [
          { id: 'a', title: 'Birinci', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'b', title: 'İkinci', createdAt: '2026-01-02T00:00:00.000Z' },
        ],
      });
    });
    await refreshRecentConversations();
    await deleteConversation('a');
    expect(calls.at(-1)).toEqual({ url: '/api/v1/conversations/a', method: 'DELETE' });
    expect(readRecentConversations().items.map((c) => c.id)).toEqual(['b']);
  });

  it('hata olursa liste değişmez ve hata fırlatılır (yasal saklama dahil)', async () => {
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return json(
          { error: { code: 'CHAT_DELETE_BLOCKED', message: null, requestId: null } },
          409,
        );
      }
      return json({
        items: [{ id: 'a', title: 'Birinci', createdAt: '2026-01-01T00:00:00.000Z' }],
      });
    });
    await refreshRecentConversations();
    await expect(deleteConversation('a')).rejects.toMatchObject({
      info: { code: 'CHAT_DELETE_BLOCKED' },
    });
    expect(readRecentConversations().items.map((c) => c.id)).toEqual(['a']);
  });
});
