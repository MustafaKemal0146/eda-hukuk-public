// Yanıt modu tercihi (053-02 §4.14; P10): Hızlı/Derin seçimi tarayıcıda hatırlanır ve istek takma
// adına `ALIAS_BY_MODE` ile çevrilir. Yalnız tercih saklanır (içerik/kimlik yok). Kapsam seçimiyle
// aynı kalıp: modül içi durum + `useSyncExternalStore`; sunucu render'ında Hızlı olduğu için
// hydration uyuşmazlığı olmaz. Geçersiz/bozuk kayıt sessizce Hızlı'ya döner.
import { useSyncExternalStore } from 'react';
import type { ComposerMode } from './composer.tsx';

/** Tarayıcıda saklanan anahtar; sürüm eki eski kayıtları geçersiz kılar. */
export const COMPOSER_MODE_KEY = 'eda:chat-mode:v1';

/** Kayıtlı değer tanınmıyorsa Hızlı'dır. */
export function parseComposerMode(raw: unknown): ComposerMode {
  return raw === 'deep' ? 'deep' : 'fast';
}

let current: ComposerMode | null = null;
const listeners = new Set<() => void>();

function read(): ComposerMode {
  if (current !== null) return current;
  if (typeof window === 'undefined') return 'fast';
  try {
    current = parseComposerMode(window.localStorage.getItem(COMPOSER_MODE_KEY));
  } catch {
    current = 'fast';
  }
  return current;
}

export function readComposerMode(): ComposerMode {
  return read();
}

export function writeComposerMode(mode: ComposerMode): void {
  current = parseComposerMode(mode);
  try {
    window.localStorage.setItem(COMPOSER_MODE_KEY, current);
  } catch {
    // Depolama kapalıysa tercih yalnız bu sekmede geçerlidir.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useComposerMode(): ComposerMode {
  return useSyncExternalStore(subscribe, read, () => 'fast');
}
