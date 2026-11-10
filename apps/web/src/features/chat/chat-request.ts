// İstek gövdesi derleme (053-02 §4.14; 022 §2.1): yalnız SON kullanıcı mesajı gönderilir, geçmiş
// sunucudadır. Kapsam seçiciden gelir (053/02 §4.3, P12 K5). Ekler son kullanıcı mesajının `file`
// parçalarından (`eda-file:<id>`; P21 ilk dilimi); bahsetme/belge alanları bu dilimde boş.
import { type ScopeItemId, scopeToRequest } from '@eda/contracts/scope';
import type { ChatTurnRequest, ModelAlias } from '@eda/contracts/stream';
import { attachmentIdsOf } from './attachment-parts.ts';
import type { ComposerMode } from './composer.tsx';

export const ALIAS_BY_MODE = {
  fast: 'edai-flash',
  deep: 'edai-pro',
} as const satisfies Record<ComposerMode, ModelAlias>;

type MinimalMessage = {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: readonly { type: string; text?: string; url?: string }[];
};

export function buildChatTurnRequest(
  messages: readonly MinimalMessage[],
  alias: ModelAlias,
  scope: readonly ScopeItemId[] | null = null,
  /** Düzenlenen kullanıcı mesajının kimliği: o mesaj ve sonrası sunucuda kesilir, metin yeni turdur. */
  replaceFromMessageId: string | null = null,
): ChatTurnRequest {
  const last = messages.at(-1);
  if (last?.role !== 'user') {
    throw new Error('Gönderilecek kullanıcı mesajı bulunamadı.');
  }
  const text = last.parts
    .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .join('');
  return {
    trigger: 'submit-message',
    message: { id: last.id, role: 'user', parts: [{ type: 'text', text }] },
    regenerateMessageId: null,
    replaceFromMessageId,
    alias,
    mode: 'chat',
    scope: { ...scopeToRequest(scope), chamber: null, dateFrom: null, dateTo: null },
    attachments: attachmentIdsOf(last.parts),
    mentions: [],
    documentId: null,
    documentBaseVersion: null,
    liveSearch: false,
  };
}

/**
 * Yeniden üretim gövdesi (022 §2.1): yalnız SON asistan yanıtı yeniden üretilir; kullanıcı mesajı
 * yeniden gönderilmez — sunucu aynı kullanıcı mesajıyla yeni turu kurar. `regenerateMessageId`
 * hedefi taşır (`null` = sunucunun son yanıtı).
 */
export function buildRegenerateRequest(
  alias: ModelAlias,
  regenerateMessageId: string | null,
  scope: readonly ScopeItemId[] | null = null,
): ChatTurnRequest {
  return {
    trigger: 'regenerate-message',
    message: null,
    regenerateMessageId,
    replaceFromMessageId: null,
    alias,
    mode: 'chat',
    scope: { ...scopeToRequest(scope), chamber: null, dateFrom: null, dateTo: null },
    attachments: [],
    mentions: [],
    documentId: null,
    documentBaseVersion: null,
    liveSearch: false,
  };
}

/**
 * Düzenleme için kesme noktası: `messageId` kimlikli kullanıcı mesajından (dahil) itibaren tüm
 * mesajlar düşer. Hedef yoksa veya kullanıcı mesajı değilse `null` (dizi değişmez).
 */
export function truncateFromMessage<T extends { id: string; role: string }>(
  messages: readonly T[],
  messageId: string,
): readonly T[] | null {
  const index = messages.findIndex((m) => m.id === messageId);
  if (index === -1 || messages[index]?.role !== 'user') return null;
  return messages.slice(0, index);
}

/** `sendMessage(..., { body })` ile gelen kesme noktasını okur; yoksa `null`. */
export function replaceFromOfBody(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'replaceFromMessageId' in body) {
    const id = (body as { replaceFromMessageId: unknown }).replaceFromMessageId;
    if (typeof id === 'string' && id !== '') return id;
  }
  return null;
}

/** `sendMessage(..., { body })` ile gelen takma adı okur; tanınmazsa Hızlı. */
export function aliasFromBody(body: unknown): ModelAlias {
  if (typeof body === 'object' && body !== null && 'alias' in body) {
    const alias = (body as { alias: unknown }).alias;
    if (alias === 'edai-pro' || alias === 'edai-flash') return alias;
  }
  return 'edai-flash';
}
