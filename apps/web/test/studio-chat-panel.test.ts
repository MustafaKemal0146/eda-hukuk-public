// @tk TK-33
// Stüdyo yan sohbet paneli: belge başına sohbet kimliği sekme belleğinde (hata toleranslı), görünüm
// seçimi (geniş ekranda yan yana, dar ekranda sekme), sohbet ekranının gömülü kipi ve metinler.
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import type { ConversationScreenProps } from '../src/features/chat/conversation-screen.tsx';
import {
  readStudioChat,
  visibleViews,
  writeStudioChat,
} from '../src/features/studio/studio-chat.ts';

function fakeStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: () => null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('KK-STUDYO-D: yan sohbet paneli', () => {
  it('belge başına sohbet kimliği yazılır, okunur, null ile silinir', () => {
    const storage = fakeStorage();
    Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });
    expect(readStudioChat('doc-1')).toBeNull();
    writeStudioChat('doc-1', 'conv-1');
    expect(readStudioChat('doc-1')).toBe('conv-1');
    expect(readStudioChat('doc-2')).toBeNull();
    writeStudioChat('doc-1', null);
    expect(storage.data.size).toBe(0);
  });

  it('depolama erişimi hata verirse okuma null, yazma patlamaz', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('kapalı');
      },
    });
    expect(readStudioChat('doc-1')).toBeNull();
    expect(() => writeStudioChat('doc-1', 'c')).not.toThrow();
  });

  it('görünüm: kapalıyken yalnız belge; geniş ekranda yan yana; dar ekranda sekme', () => {
    expect(visibleViews({ wide: true, chatOpen: false, view: 'chat' })).toEqual({
      document: true,
      chat: false,
      tabs: false,
    });
    expect(visibleViews({ wide: true, chatOpen: true, view: 'document' })).toEqual({
      document: true,
      chat: true,
      tabs: false,
    });
    expect(visibleViews({ wide: false, chatOpen: true, view: 'chat' })).toEqual({
      document: false,
      chat: true,
      tabs: true,
    });
    expect(visibleViews({ wide: false, chatOpen: true, view: 'document' })).toEqual({
      document: true,
      chat: false,
      tabs: true,
    });
  });

  it('sohbet ekranı gömülü kip ve uygulama sonrası geri çağrı kabul eder; metinler katalogda', () => {
    const props: ConversationScreenProps = {
      conversationId: 'c',
      embedded: true,
      onApplied: () => {},
    };
    expect(props.embedded).toBe(true);
    const c = messages.studio.chat;
    for (const k of ['button', 'title', 'close', 'viewsLabel', 'tabDocument', 'tabChat'] as const) {
      expect(c[k]).toBeTruthy();
    }
  });
});
