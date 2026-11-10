// Tablo ilkelleri (052 §3 DataTable temeli): yalnız görünüm; `caption` zorunlu, başlıklar `scope="col"`.
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn.ts';

export function Table({
  caption,
  captionHidden = true,
  className,
  children,
}: {
  caption: string;
  captionHidden?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface', className)}>
      <table className="w-full border-collapse text-body-sm">
        <caption className={captionHidden ? 'sr-only' : 'px-4 py-3 text-left text-title text-fg'}>
          {caption}
        </caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...rest }: ComponentProps<'th'>) {
  return (
    <th
      scope="col"
      {...rest}
      className={cn(
        'h-9 border-b border-border bg-surface-sunken px-4 text-left text-caption font-medium whitespace-nowrap text-fg-muted',
        className,
      )}
    />
  );
}

export function Td({ className, ...rest }: ComponentProps<'td'>) {
  return (
    <td
      {...rest}
      className={cn('h-row border-b border-border px-4 align-middle text-fg', className)}
    />
  );
}

export function Tr({ className, ...rest }: ComponentProps<'tr'>) {
  return (
    <tr
      {...rest}
      className={cn('transition-colors duration-fast hover:bg-surface-sunken', className)}
    />
  );
}
