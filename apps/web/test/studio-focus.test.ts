// @tk TK-33
// Stüdyo odak modu: kısayol çözümü (Ctrl+S / Ctrl+F / Ctrl+Shift+F / Esc), tercihin hata toleranslı
// saklanması ve metinlerin katalogda bulunması.
import { afterEach, describe, expect, it } from 'vitest';
import messages from '../messages/tr.json';
import {
  type KeyLike,
  readFocusPref,
  studioShortcutOf,
  writeFocusPref,
} from '../src/features/studio/studio-prefs.ts';

const key = (over: Partial<KeyLike>): KeyLike => ({
  key: '',
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

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
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('KK-STUDYO-A: odak modu kısayolları', () => {
  it('Ctrl+S kaydet, Ctrl+F bul, Ctrl+Shift+F odak, Esc çıkış; Cmd de geçerli', () => {
    expect(studioShortcutOf(key({ key: 's', ctrlKey: true }))).toBe('save');
    expect(studioShortcutOf(key({ key: 'S', metaKey: true }))).toBe('save');
    expect(studioShortcutOf(key({ key: 'f', ctrlKey: true }))).toBe('find');
    expect(studioShortcutOf(key({ key: 'F', ctrlKey: true, shiftKey: true }))).toBe('focus');
    expect(studioShortcutOf(key({ key: 'Escape' }))).toBe('escape');
  });

  it('değiştiricisiz harf, Alt bileşimi ve Shift+Esc kısayol değildir', () => {
    expect(studioShortcutOf(key({ key: 's' }))).toBeNull();
    expect(studioShortcutOf(key({ key: 'f', ctrlKey: true, altKey: true }))).toBeNull();
    expect(studioShortcutOf(key({ key: 'Escape', shiftKey: true }))).toBeNull();
    expect(studioShortcutOf(key({ key: 's', ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe('KK-STUDYO-A: odak tercihi', () => {
  it('yazılır, okunur, kapatılınca silinir', () => {
    const storage = fakeStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
    expect(readFocusPref()).toBe(false);
    writeFocusPref(true);
    expect(readFocusPref()).toBe(true);
    expect(storage.data.size).toBe(1);
    writeFocusPref(false);
    expect(storage.data.size).toBe(0);
    expect(readFocusPref()).toBe(false);
  });

  it('depolama erişimi hata fırlatırsa varsayılan döner ve yazım patlamaz', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('kapalı');
      },
    });
    expect(readFocusPref()).toBe(false);
    expect(() => writeFocusPref(true)).not.toThrow();
  });

  it('metinler katalogda', () => {
    expect(messages.studio.focus.enter).toBeTruthy();
    expect(messages.studio.focus.exit).toBeTruthy();
    expect(messages.studio.focus.hint).toContain('Esc');
  });
});
