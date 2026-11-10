// ReasoningBlock (052 §2, AI Elements `Reasoning` uyarlaması; Apache-2.0, kod kopyalanmadı):
// varsayılan kapalı <details>. Yalnız çağıran gösterirse (org_settings.show_reasoning) çizilir.
import type { ReactNode } from 'react';
import { cn } from '../components/cn.ts';
import { Icon } from '../icons/icon.tsx';

export function ReasoningBlock({
  summary,
  className,
  children,
}: {
  /** Özet satırı ("Akıl yürütme"). */
  summary: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cn('group rounded-md border border-border bg-surface-sunken', className)}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-3 text-body-sm text-fg-muted hover:text-fg focus-visible:focus-ring-inset [&::-webkit-details-marker]:hidden">
        <Icon
          icon="control.chevron-right"
          size="sm"
          className="shrink-0 transition-transform duration-fast group-open:rotate-90"
        />
        {summary}
      </summary>
      <div className="border-t border-border px-3 py-2.5 text-body-sm text-fg-muted">
        {children}
      </div>
    </details>
  );
}
