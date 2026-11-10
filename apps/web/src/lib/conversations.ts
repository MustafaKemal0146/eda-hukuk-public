// Sohbet uçlarının tarayıcı istemcisi (aynı origin `/api/v1/conversations`; 002 §15) ve kenar çubuğu
// "Son sohbetler" deposu. Sohbet ekranı ile kabuk aynı listeyi paylaşır: özellikler birbirini içe
// aktarmadığı için ortak durum burada (lib) tutulur. Yanıt gövdeleri tip korumasıyla daraltılır;
// sohbet DTO şemaları @eda/contracts'a taşınınca Zod ile değişir (P09a).
import { useSyncExternalStore } from 'react';
import { ApiError, parseErrorEnvelope } from './api-error.ts';
import { guardedFetch } from './session-guard.ts';
import { uuidv7 } from './uuid.ts';

export const CONVERSATIONS_API = '/api/v1/conversations';

export type ConversationSummary = { id: string; title: string | null; createdAt: string };

export type ConversationDetail = {
  id: string;
  title: string | null;
  /** Ham UIMessage dizisi; sohbet özelliği AI SDK şemalarıyla doğrular. */
  messages: unknown[];
  streamingMessageId: string | null;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function invalidResponse(status: number): ApiError {
  return new ApiError({ code: 'CLIENT_INVALID_RESPONSE', message: null, requestId: null, status });
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  headers.set('x-request-id', uuidv7());
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  let res: Response;
  try {
    res = await guardedFetch(path, {
      ...init,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError({ code: 'CLIENT_NETWORK', message: null, requestId: null, status: null });
  }
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(
      parseErrorEnvelope(text, res.status) ?? {
        code: 'CLIENT_HTTP_ERROR',
        message: null,
        requestId: res.headers.get('x-request-id'),
        status: res.status,
      },
    );
  }
  try {
    return text === '' ? null : JSON.parse(text);
  } catch {
    throw invalidResponse(res.status);
  }
}

export async function createConversation(): Promise<string> {
  const body = await request(CONVERSATIONS_API, { method: 'POST', body: '{}' });
  if (!isRecord(body) || typeof body.id !== 'string') throw invalidResponse(201);
  return body.id;
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  const body = await request(`${CONVERSATIONS_API}/${encodeURIComponent(id)}`);
  if (!isRecord(body) || typeof body.id !== 'string' || !Array.isArray(body.messages)) {
    throw invalidResponse(200);
  }
  return {
    id: body.id,
    title: typeof body.title === 'string' ? body.title : null,
    messages: body.messages,
    streamingMessageId:
      typeof body.streamingMessageId === 'string' ? body.streamingMessageId : null,
  };
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const body = await request(CONVERSATIONS_API);
  if (!isRecord(body) || !Array.isArray(body.items)) throw invalidResponse(200);
  return body.items.flatMap((item): ConversationSummary[] =>
    isRecord(item) && typeof item.id === 'string'
      ? [
          {
            id: item.id,
            title: typeof item.title === 'string' ? item.title : null,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
          },
        ]
      : [],
  );
}

/** Sohbeti siler (204). Başarıdan sonra "Son sohbetler" listesinden de düşürülür. */
export async function deleteConversation(id: string): Promise<void> {
  await request(`${CONVERSATIONS_API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  setRecent({ state: 'ready', items: recent.items.filter((c) => c.id !== id) });
}

export async function stopConversationTurn(id: string, messageId: string): Promise<void> {
  await request(`${CONVERSATIONS_API}/${encodeURIComponent(id)}/stop`, {
    method: 'POST',
    body: JSON.stringify({ messageId }),
  });
}

// --- Son sohbetler deposu (useSyncExternalStore) ---------------------------------------------

export type RecentConversations =
  | { state: 'idle' | 'loading' | 'error'; items: readonly ConversationSummary[] }
  | { state: 'ready'; items: readonly ConversationSummary[] };

let recent: RecentConversations = { state: 'idle', items: [] };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;

function setRecent(next: RecentConversations): void {
  recent = next;
  for (const l of listeners) l();
}

/**
 * Listeyi sunucudan yeniler; aynı anda tek istek. Sunucu sırası korunur: `GET /conversations`
 * sohbetleri son mesaj zamanına göre döndürür (`last_message_at DESC`), oluşturma zamanına göre
 * yeniden sıralamak "son kullanılan" sohbeti listebaştan düşürürdü. Hata listeyi silmez; durum
 * `error` olur ve kenar çubuğu yeniden deneme sunar.
 */
export function refreshRecentConversations(): Promise<void> {
  if (inFlight) return inFlight;
  if (recent.state !== 'ready') setRecent({ state: 'loading', items: recent.items });
  inFlight = listConversations()
    .then((items) => setRecent({ state: 'ready', items }))
    .catch(() => setRecent({ state: 'error', items: recent.items }))
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** React dışı okuyucular ve testler için anlık görüntü (nesne kimliği sabittir). */
export function readRecentConversations(): RecentConversations {
  return recent;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (recent.state === 'idle') void refreshRecentConversations();
  return () => listeners.delete(listener);
}

const SERVER_SNAPSHOT: RecentConversations = { state: 'idle', items: [] };

export function useRecentConversations(): RecentConversations {
  return useSyncExternalStore(
    subscribe,
    () => recent,
    () => SERVER_SNAPSHOT,
  );
}
