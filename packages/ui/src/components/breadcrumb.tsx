// Breadcrumb (052 §3): hiyerarşi (Dosyalar / Dava / Evrak). `nav` adı çağırandan ("Konum");
// son öğe `aria-current="page"` taşır ve bağlantı değildir. Bağlantı `render` ile (Next Link) verilir.
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export type BreadcrumbItem = {
  label: ReactNode;
  /** Bağlantı öğesi (ör. `<Link href="/dosyalar" />`); son öğede yok sayılır. */
  render?: ReactElement<Record<string, unknown>>;
};

export function Breadcrumb({
  items,
  label,
  className,
}: {
  items: readonly BreadcrumbItem[];
  /** `nav` erişilebilir adı. */
  label: string;
  className?: string;
}) {
  const last = items.length - 1;
  return (
    <nav aria-label={label} className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-body-sm text-fg-muted">
        {items.map((item, i) => (
          <li key={i} className="inline-flex min-w-0 items-center gap-1">
            {i === last || !isValidElement(item.render) ? (
              <span
                aria-current={i === last ? 'page' : undefined}
                className={cn('truncate', i === last && 'font-medium text-fg')}
              >
                {item.label}
              </span>
            ) : (
              cloneElement(item.render, {
                className:
                  'inline-flex min-h-6 items-center truncate rounded-sm hover:text-fg hover:underline focus-visible:focus-ring pointer-coarse:min-h-11',
                children: item.label,
              })
            )}
            {i !== last && (
              <Icon icon="control.chevron-right" size="sm" className="shrink-0 text-fg-subtle" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
