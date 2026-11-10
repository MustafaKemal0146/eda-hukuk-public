// Stüdyo yan sohbeti (saf model): belge başına son sohbet kimliği sekme belleğinde tutulur ki panel
// kapanıp açılınca ve belge yeniden yüklenince aynı sohbet gelsin. İçerik saklanmaz, yalnız kimlik.
const KEY = 'eda:studio-chat:';

export function readStudioChat(documentId: string): string | null {
  try {
    return sessionStorage.getItem(`${KEY}${documentId}`);
  } catch {
    return null;
  }
}

export function writeStudioChat(documentId: string, conversationId: string | null): void {
  try {
    if (conversationId === null) sessionStorage.removeItem(`${KEY}${documentId}`);
    else sessionStorage.setItem(`${KEY}${documentId}`, conversationId);
  } catch {
    // Depolama kapalıysa panel yalnız bu görünümde hatırlar.
  }
}

export type StudioView = 'document' | 'chat';

/** Dar ekranda panel sekmedir: hangi görünüm gösterilir? Geniş ekranda ikisi yan yanadır. */
export function visibleViews(opts: { wide: boolean; chatOpen: boolean; view: StudioView }): {
  document: boolean;
  chat: boolean;
  tabs: boolean;
} {
  if (!opts.chatOpen) return { document: true, chat: false, tabs: false };
  if (opts.wide) return { document: true, chat: true, tabs: false };
  return { document: opts.view === 'document', chat: opts.view === 'chat', tabs: true };
}
