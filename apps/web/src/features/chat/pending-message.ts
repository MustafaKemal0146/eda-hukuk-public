// Yeni sohbetin ilk mesajı (053-02 §1.4): `/sohbet`'te sohbet oluşturulur, metin burada bekletilir,
// `/sohbet/[conversationId]` bağlanınca BİR KEZ gönderilir. Bellek içidir (istemci gezinmesi boyunca
// yaşar); tam sayfa yenilemede kaybolur ve sohbet boş açılır.
import type { ModelAlias } from '@eda/contracts/stream';
import type { FileUIPart } from 'ai';

/** `files`: hazır ek parçaları (`eda-file:<id>`; bayt yok). */
export type PendingFirstMessage = {
  text: string;
  alias: ModelAlias;
  files?: readonly FileUIPart[];
};

const pending = new Map<string, PendingFirstMessage>();

export function setPendingFirstMessage(conversationId: string, message: PendingFirstMessage): void {
  pending.set(conversationId, message);
}

/** Okur ama silmez: Strict Mode çift çağrısında kaybolmasın; gönderen `clear` çağırır. */
export function peekPendingFirstMessage(conversationId: string): PendingFirstMessage | null {
  return pending.get(conversationId) ?? null;
}

export function clearPendingFirstMessage(conversationId: string): void {
  pending.delete(conversationId);
}
