// Select (052 §3, MVP): yerel <select> + tutarlı görünüm. Klavye ve ekran okuyucu davranışı tarayıcınındır.
import type { ComponentProps } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';
import { CONTROL_BASE } from './input.tsx';

export type SelectOption = { value: string; label: string };

export type SelectProps = Omit<ComponentProps<'select'>, 'size'> & {
  options: readonly SelectOption[];
  size?: 'sm' | 'md';
};

export function Select({ options, size = 'md', className, ...rest }: SelectProps) {
  return (
    <div className={cn('relative', className)}>
      <select
        {...rest}
        className={cn(
          CONTROL_BASE,
          'appearance-none pr-8 pl-2.5',
          size === 'sm' ? 'min-h-control-sm' : 'min-h-control-md',
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        icon="control.chevrons-up-down"
        size="sm"
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-subtle"
      />
    </div>
  );
}
