// Oturum sayfa açıkken biterse yazılmış ama gönderilmemiş sohbet taslağı kaybolmasın: metin yalnız bu
// sekmenin `sessionStorage`'ında, kısa süreliğine ve yol başına saklanır; girişten dönüşte BİR KEZ okunup
// silinir. Sunucuya, log'a, kuyruğa gitmez. Depolama kapalıysa sessizce atlanır.
import { safeNext } from './safe-next.ts';

export const DRAFT_TTL_MS = 30 * 60_000;
export const DRAFT_MAX_CHARS = 20_000;
const PREFIX = 'eda:draft:';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const keyOf = (path: string): string => `${PREFIX}${safeNext(path)}`;

function defaultStore(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function stashDraft(
  path: string,
  text: string,
  now: number = Date.now(),
  store: Store | null = defaultStore(),
): void {
  if (store === null || text.trim() === '') return;
  try {
    store.setItem(keyOf(path), JSON.stringify({ t: text.slice(0, DRAFT_MAX_CHARS), at: now }));
  } catch {
    // depolama dolu/kapalı
  }
}

/** Saklı taslağı döndürür ve siler; süresi dolmuş veya bozuk kayıt `null`. */
export function takeDraft(
  path: string,
  now: number = Date.now(),
  store: Store | null = defaultStore(),
): string | null {
  if (store === null) return null;
  try {
    const key = keyOf(path);
    const raw = store.getItem(key);
    if (raw === null) return null;
    store.removeItem(key);
    const v = JSON.parse(raw) as { t?: unknown; at?: unknown };
    if (typeof v.t !== 'string' || typeof v.at !== 'number') return null;
    if (now - v.at < 0 || now - v.at > DRAFT_TTL_MS) return null;
    return v.t === '' ? null : v.t;
  } catch {
    return null;
  }
}
