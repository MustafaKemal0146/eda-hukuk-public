'use client';
// Tabs (052 §3): otomatik etkinleştirme yok (ok tuşu odak taşır, Enter/Space seçer).
import { Tabs as Base } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';

export type TabItem<V extends string> = { value: V; label: ReactNode; count?: number };

export function Tabs<V extends string>({
  value,
  onValueChange,
  items,
  label,
  children,
  className,
}: {
  value: V;
  onValueChange: (value: V) => void;
  items: readonly TabItem<V>[];
  label: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Base.Root
      value={value}
      onValueChange={(v: unknown) => onValueChange(v as V)}
      className={className}
    >
      <Base.List
        aria-label={label}
        activateOnFocus={false}
        className="relative flex gap-5 overflow-x-auto border-b border-border"
      >
        {items.map((t) => (
          <Base.Tab
            key={t.value}
            value={t.value}
            className={cn(
              'inline-flex min-h-control-md items-center gap-2 border-b-2 border-transparent px-1 text-body-sm font-medium text-fg-subtle pointer-coarse:min-h-11',
              'hover:text-fg focus-visible:focus-ring-inset aria-selected:border-primary aria-selected:text-fg',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-sm bg-neutral-soft px-1.5 text-caption tabular-nums text-fg-muted">
                {t.count}
              </span>
            )}
          </Base.Tab>
        ))}
      </Base.List>
      {children}
    </Base.Root>
  );
}

export const TabPanel = Base.Panel;
