'use client';
// ConversationView (052 §2, AI Elements `Conversation` uyarlaması; Apache-2.0, kod kopyalanmadı):
// yalnız kullanıcı en alttaysa yeni içerikte otomatik kaydırır; değilse "En son yanıta git" düğmesi.
// Kaydırma `behavior: auto` (yumuşak kaydırma yok); canlı bölge EKLENMEZ (duyuru Announcer'ın işidir).
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../components/button.tsx';
import { cn } from '../components/cn.ts';

/** En alt sayılan eşik (px): kullanıcı bu kadar yakınsa "altta" kabul edilir. */
const BOTTOM_SLACK_PX = 48;

export type ConversationViewProps = {
  /** Kaydırma bölgesinin erişilebilir adı ("Sohbet"). */
  label: string;
  labels: { scrollToLatest: string };
  className?: string;
  children: ReactNode;
};

export function ConversationView({ label, labels, className, children }: ConversationViewProps) {
  const scroller = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  const measure = useCallback((): void => {
    const el = scroller.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK_PX;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
  }, []);

  const scrollToLatest = useCallback((): void => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    measure();
  }, [measure]);

  // Yeni mesaj (yeniden çizim): kullanıcı alttaysa izle.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  });

  useEffect(() => {
    const el = content.current;
    if (!el) return;
    // Akan içerik kendi içinde büyüdüğünde (üst yeniden çizilmeden) yalnız kullanıcı alttaysa izlenir.
    const observer = new ResizeObserver(() => {
      const box = scroller.current;
      if (box && atBottomRef.current) box.scrollTop = box.scrollHeight;
      else measure();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className={cn('relative min-h-0', className)}>
      <section
        ref={scroller}
        aria-label={label}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: kaydırılabilir bölge klavyeyle kaydırılabilmelidir (WCAG 2.1.1)
        tabIndex={0}
        onScroll={measure}
        className="h-full overflow-y-auto focus-visible:focus-ring-inset"
      >
        <div ref={content} className="flex flex-col gap-6">
          {children}
        </div>
      </section>
      {!atBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            trailingIcon="control.scroll-to-latest"
            onClick={scrollToLatest}
            className="pointer-events-auto shadow-2"
          >
            {labels.scrollToLatest}
          </Button>
        </div>
      )}
    </div>
  );
}
