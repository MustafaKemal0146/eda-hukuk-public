'use client';
// Accordion (052 §3): açılır bölümler (hesap adımları, gerekçe, referans kodu). Başlık bir düğmedir,
// durumu `aria-expanded` ile verir (Base UI); başlık düzeyi bağlama göre `headingLevel` ile seçilir.
import { Accordion as Base } from '@base-ui/react/accordion';
import type { ReactNode } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export type AccordionProps<V extends string> = {
  /** Aynı anda birden çok bölüm açık olabilir mi. */
  multiple?: boolean;
  defaultValue?: readonly V[];
  value?: readonly V[];
  onValueChange?: (value: V[]) => void;
  /** Çerçeveli (kart içinde) veya yalın (liste) görünüm. */
  variant?: 'outline' | 'plain';
  className?: string;
  children: ReactNode;
};

export function Accordion<V extends string>({
  multiple = false,
  defaultValue,
  value,
  onValueChange,
  variant = 'outline',
  className,
  children,
}: AccordionProps<V>) {
  return (
    <Base.Root
      multiple={multiple}
      {...(defaultValue === undefined ? {} : { defaultValue: [...defaultValue] })}
      {...(value === undefined ? {} : { value: [...value] })}
      {...(onValueChange === undefined
        ? {}
        : { onValueChange: (next: unknown[]) => onValueChange(next as V[]) })}
      className={cn(
        'flex flex-col',
        variant === 'outline' &&
          'divide-y divide-border rounded-lg border border-border bg-surface',
        className,
      )}
    >
      {children}
    </Base.Root>
  );
}

export type AccordionItemProps<V extends string> = {
  value: V;
  title: ReactNode;
  /** Başlığın sağında ikincil bilgi (sayı, durum rozeti). */
  aside?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  disabled?: boolean;
  children: ReactNode;
};

const HEADING = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export function AccordionItem<V extends string>({
  value,
  title,
  aside,
  headingLevel = 3,
  disabled = false,
  children,
}: AccordionItemProps<V>) {
  const H = HEADING[headingLevel];
  return (
    <Base.Item value={value} disabled={disabled} className="group">
      <Base.Header render={<H />} className="m-0">
        <Base.Trigger
          className={cn(
            'flex min-h-control-lg w-full items-center gap-3 px-4 text-left text-body-sm font-medium text-fg',
            'transition-colors duration-fast hover:bg-surface-sunken focus-visible:focus-ring-inset',
            'disabled:cursor-not-allowed disabled:text-disabled-fg pointer-coarse:min-h-11',
          )}
        >
          <span className="min-w-0 flex-1">{title}</span>
          {aside}
          <Icon
            icon="control.chevron-down"
            size="sm"
            className="shrink-0 text-fg-subtle transition-transform duration-fast group-data-[open]:rotate-180"
          />
        </Base.Trigger>
      </Base.Header>
      <Base.Panel className="px-4 pt-1 pb-4 text-body-sm text-fg-muted">{children}</Base.Panel>
    </Base.Item>
  );
}
