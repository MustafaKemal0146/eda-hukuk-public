// @tk TK-33
// #16 (P10; 053-02 §4.14, KK-053-02-8 alt kümesi): Hızlı/Derin seçimi tarayıcıda hatırlanır; seçim
// `ALIAS_BY_MODE` ile istek takma adına çevrilir; tanınmayan kayıt sessizce Hızlı'ya döner.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALIAS_BY_MODE } from '../src/features/chat/chat-request.ts';
import {
  COMPOSER_MODE_KEY,
  parseComposerMode,
  readComposerMode,
  writeComposerMode,
} from '../src/features/chat/composer-mode-store.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('KK-053-02-8: yanıt modu tercihi', () => {
  it('tanınmayan veya geçersiz kayıt Hızlı olur', () => {
    expect(parseComposerMode('deep')).toBe('deep');
    expect(parseComposerMode('fast')).toBe('fast');
    expect(parseComposerMode('baska')).toBe('fast');
    expect(parseComposerMode(null)).toBe('fast');
    expect(parseComposerMode(5)).toBe('fast');
    expect(parseComposerMode({ mode: 'deep' })).toBe('fast');
  });

  it('seçim yazılır ve geri okunur', () => {
    writeComposerMode('deep');
    expect(readComposerMode()).toBe('deep');
    writeComposerMode('fast');
    expect(readComposerMode()).toBe('fast');
  });

  it('kayıtlı tercih açılışta okunur (localStorage)', async () => {
    const store = new Map<string, string>([[COMPOSER_MODE_KEY, 'deep']]);
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
      },
    });
    vi.resetModules();
    const mod = await import('../src/features/chat/composer-mode-store.ts');
    expect(mod.readComposerMode()).toBe('deep');
  });

  it('seçim istek takma adına çevrilir (Hızlı/Derin)', () => {
    expect(ALIAS_BY_MODE).toEqual({ fast: 'edai-flash', deep: 'edai-pro' });
  });
});
