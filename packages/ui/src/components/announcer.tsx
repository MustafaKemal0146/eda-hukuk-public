'use client';
// Announcer (052 §3, 055 §4): kabuk içi iki KALICI canlı bölge (polite / assertive). Bölgeler ilk
// boyamada boş basılır ve koşullu mount edilmez. `announce(text, { politeness, key })`: `coalesceMs`
// penceresinde gelen iletiler ". " ile tek metinde birleştirilir (055 §4.1; cümle sonu imiyle
// biten iletiden sonra yalnız boşluk); aynı `key` ile gelen ileti öncekinin yerine geçer
// (tekilleştirme). Bileşenler kendi `aria-live`'ını açmaz; duyuru yalnız buradan yapılır.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type Politeness = 'polite' | 'assertive';
export type AnnounceOptions = { politeness?: Politeness; key?: string };
export type Announce = (text: string, options?: AnnounceOptions) => void;

const AnnounceContext = createContext<Announce | null>(null);

type Pending = Map<string, string>;
type Message = { id: number; text: string };
const EMPTY: Message = { id: 0, text: '' };
const SENTENCE_END = /[.!?…:;]$/u;

/** Pencere içindeki iletileri ". " ile birleştirir; zaten noktalanmış iletiye ikinci nokta eklemez. */
function joinAnnouncements(texts: readonly string[]): string {
  let out = '';
  for (const raw of texts) {
    const text = raw.trim();
    if (text === '') continue;
    out = out === '' ? text : `${out}${SENTENCE_END.test(out) ? ' ' : '. '}${text}`;
  }
  return out;
}

export function Announcer({
  coalesceMs,
  children,
}: {
  /** Birleştirme penceresi (çağıran `ui.liveRegionCoalesceMs` verir). */
  coalesceMs: number;
  children?: ReactNode;
}) {
  const [messages, setMessages] = useState<Record<Politeness, Message>>({
    polite: EMPTY,
    assertive: EMPTY,
  });
  const pending = useRef<Record<Politeness, Pending>>({ polite: new Map(), assertive: new Map() });
  const timers = useRef<Record<Politeness, ReturnType<typeof setTimeout> | null>>({
    polite: null,
    assertive: null,
  });
  const seq = useRef(0);

  const flush = useCallback((politeness: Politeness) => {
    timers.current[politeness] = null;
    const text = joinAnnouncements([...pending.current[politeness].values()]);
    pending.current[politeness].clear();
    if (text === '') return;
    // Her duyuru yeni bir düğümdür (`id` anahtarı): aynı metin art arda gelse de okunur.
    setMessages((prev) => ({ ...prev, [politeness]: { id: prev[politeness].id + 1, text } }));
  }, []);

  const announce = useCallback<Announce>(
    (text, options) => {
      const politeness = options?.politeness ?? 'polite';
      const key = options?.key ?? `#${seq.current++}`;
      const queue = pending.current[politeness];
      queue.delete(key);
      queue.set(key, text);
      if (timers.current[politeness] === null) {
        timers.current[politeness] = setTimeout(() => flush(politeness), coalesceMs);
      }
    },
    [coalesceMs, flush],
  );

  useEffect(
    () => () => {
      for (const p of ['polite', 'assertive'] as const) {
        const t = timers.current[p];
        if (t !== null) clearTimeout(t);
      }
    },
    [],
  );

  const value = useMemo(() => announce, [announce]);
  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div data-slot="announcer" className="sr-only">
        <div role="status" aria-live="polite" aria-atomic="true" data-politeness="polite">
          {messages.polite.text && <span key={messages.polite.id}>{messages.polite.text}</span>}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true" data-politeness="assertive">
          {messages.assertive.text && (
            <span key={messages.assertive.id}>{messages.assertive.text}</span>
          )}
        </div>
      </div>
    </AnnounceContext.Provider>
  );
}

/** `Announcer` altındaki duyuru işlevi; sağlayıcı yoksa hata verir (sessiz kayıp olmasın). */
export function useAnnounce(): Announce {
  const announce = useContext(AnnounceContext);
  if (announce === null) {
    throw new Error('useAnnounce yalnız <Announcer> içinde kullanılabilir.');
  }
  return announce;
}
