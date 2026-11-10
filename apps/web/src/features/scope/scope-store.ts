// Yargı kapsamı seçimi (053/02 §4.3): sohbetler arası korunur; yalnız kurum kimlikleri saklanır
// (sorgu metni değil). `null` = Akıllı otomatik seçim. Geçersiz/eski kayıt sessizce otomatiğe döner.
import { SCOPE_ITEM_IDS, type ScopeItemId } from '@eda/contracts/scope';
import { useSyncExternalStore } from 'react';

const KEY = 'eda:chat-scope:v1';

let current: ScopeItemId[] | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function load(): void {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    if (Array.isArray(raw)) {
      const ids = SCOPE_ITEM_IDS.filter((id) => raw.includes(id));
      current = ids.length > 0 ? ids : null;
    }
  } catch {
    current = null;
  }
}

export function readScope(): ScopeItemId[] | null {
  load();
  return current;
}

export function writeScope(next: readonly ScopeItemId[] | null): void {
  load();
  // Katalog sırası korunur: aynı seçim aynı istek gövdesini üretir.
  const ids = next === null ? [] : SCOPE_ITEM_IDS.filter((id) => next.includes(id));
  current = ids.length > 0 ? ids : null;
  try {
    if (current === null) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Depolama kapalıysa seçim yalnız bu sekmede geçerlidir.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useScope(): ScopeItemId[] | null {
  return useSyncExternalStore(subscribe, readScope, () => null);
}
