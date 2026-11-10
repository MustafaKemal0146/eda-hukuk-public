// ScrollArea (052 §3): kendi kaydırma bölgesi (A4 tuvali, tablo, kod bloğu). Yerel kaydırma
// kullanılır: kaydırma çubuğu gizlenmez (051 §13.4), klavyeyle kaydırılabilsin diye bölge odak
// alır (`tabIndex=0` + `role="region"` + `aria-label`). Base UI ScrollArea yerel çubuğu gizleyip
// özel çubuk çizdiği için bilinçli olarak kullanılmaz.
import type { ReactNode } from 'react';
import { cn } from './cn.ts';

export function ScrollArea({
  label,
  orientation = 'vertical',
  className,
  children,
}: {
  /** Bölgenin erişilebilir adı. */
  label: string;
  orientation?: 'vertical' | 'horizontal' | 'both';
  /** Yerleşim: yükseklik/genişlik sınırı (ör. `max-h-80`). */
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: kaydırılabilir bölge klavyeyle erişilebilmelidir (WCAG 2.1.1).
      tabIndex={0}
      className={cn(
        'min-h-0 min-w-0 focus-visible:focus-ring-inset',
        orientation === 'vertical' && 'overflow-y-auto',
        orientation === 'horizontal' && 'overflow-x-auto',
        orientation === 'both' && 'overflow-auto',
        className,
      )}
    >
      {children}
    </section>
  );
}
