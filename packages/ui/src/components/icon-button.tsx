'use client';
// IconButton (052 §3): yalnız simgeli denetim. `label` ZORUNLU (erişilebilir ad; title tek başına yetmez).

import { useRender } from '@base-ui/react/use-render';
import type { ComponentProps, ReactElement } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'aria-label'> & {
  icon: IconName;
  label: string;
  variant?: 'ghost' | 'outline' | 'primary';
  size?: 'sm' | 'md' | 'lg';
  /** Okunmamış/yeni işareti (simge yanında nokta; anlamı `label` metninde de verilmeli). */
  indicator?: boolean;
  render?: ReactElement;
};

const VARIANT = {
  ghost: 'bg-transparent text-fg-muted border-transparent hover:bg-primary-soft hover:text-fg',
  outline: 'bg-surface text-fg-muted border-border shadow-1 hover:bg-surface-sunken hover:text-fg',
  primary: 'bg-primary text-on-primary border-primary shadow-1 hover:bg-primary-hover',
} as const;

const SIZE = { sm: 'size-7', md: 'size-8', lg: 'size-10' } as const;

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  indicator = false,
  render,
  className,
  type,
  ...rest
}: IconButtonProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      ...rest,
      type: render === undefined ? (type ?? 'button') : type,
      'aria-label': label,
      className: cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-md border',
        'transition-colors duration-fast ease-standard focus-visible:focus-ring',
        'disabled:cursor-not-allowed disabled:text-disabled-fg pointer-coarse:size-11',
        VARIANT[variant],
        SIZE[size],
        className,
      ),
      children: (
        <>
          <Icon icon={icon} size={size === 'lg' ? 'md' : 'sm'} />
          {indicator && (
            <span className="absolute top-1 right-1 size-2 rounded-full border border-surface bg-danger" />
          )}
        </>
      ),
    },
  });
}
