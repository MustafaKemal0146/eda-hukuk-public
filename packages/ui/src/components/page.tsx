// Sayfa yerleşim ilkelleri: PageContainer (genişlik), PageHeader (serif başlık + eylemler + araç
// satırı), SectionHeader (kartsız bölüm başlığı). Metinler çağırandan gelir.
import type { ReactNode } from 'react';
import { cn } from './cn.ts';

const WIDTH = { doc: 'max-w-doc', content: 'max-w-content', chat: 'max-w-chat' } as const;

export function PageContainer({
  children,
  width = 'doc',
  className,
}: {
  children: ReactNode;
  width?: keyof typeof WIDTH;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-8 px-4 py-8 md:px-8 md:py-10',
        WIDTH[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Başlığın altındaki araç satırı (arama, süzgeç, sekme). */
  children?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-heading-lg text-fg">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-2xl text-body-sm text-fg-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function SectionHeader({
  id,
  title,
  description,
  action,
  as: H = 'h2',
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <H id={id} className="text-title text-fg">
          {title}
        </H>
        {description && <p className="mt-0.5 text-body-sm text-fg-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
