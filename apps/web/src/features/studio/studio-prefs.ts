// Stüdyo tercihleri ve kısayol modeli (saf; DOM'suz test edilir). Odak modu tercihi yalnız bu
// tarayıcıda, içeriksiz bir bayraktır (localStorage; depolama kapalıysa sessizce varsayılan).
const FOCUS_KEY = 'eda:studio:focus';

export function readFocusPref(): boolean {
  try {
    return localStorage.getItem(FOCUS_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeFocusPref(on: boolean): void {
  try {
    if (on) localStorage.setItem(FOCUS_KEY, '1');
    else localStorage.removeItem(FOCUS_KEY);
  } catch {
    // Depolama kapalıysa tercih yalnız bu oturumda geçerlidir.
  }
}

export type StudioShortcut = 'focus' | 'save' | 'find' | 'escape';

export type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

const isKey = (e: KeyLike, lower: string, upper: string): boolean =>
  e.key === lower || e.key === upper;

/**
 * Klavye kısayolu çözümü: Ctrl/Cmd+S kaydet, Ctrl/Cmd+F bul, Ctrl/Cmd+Shift+F odak modu, Esc çık.
 * Alt ile birlikte hiçbiri; büyük/küçük harf ayrımı yok (Shift ve Caps Lock durumları).
 */
export function studioShortcutOf(e: KeyLike): StudioShortcut | null {
  if (e.altKey) return null;
  const mod = e.ctrlKey || e.metaKey;
  if (!mod && !e.shiftKey && e.key === 'Escape') return 'escape';
  if (!mod) return null;
  if (isKey(e, 's', 'S') && !e.shiftKey) return 'save';
  if (isKey(e, 'f', 'F')) return e.shiftKey ? 'focus' : 'find';
  return null;
}
