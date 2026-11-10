'use client';
// Button (052 §3): 5 varyant, 3 boyut, yükleniyor durumu, ön/arka simge, `render` ile bağlantı birleşimi.
// Devre dışı gerekçesi gösterilecekse `disabled` yerine `aria-disabled` + `aria-describedby` kullanılır.
import { useRender } from '@base-ui/react/use-render';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export const BUTTON_VARIANTS = ['primary', 'secondary', 'outline', 'ghost', 'danger'] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-on-primary border-primary shadow-1 hover:bg-primary-hover hover:border-primary-hover active:bg-primary-active',
  secondary: 'bg-neutral-soft text-fg border-transparent hover:bg-primary-soft',
  outline:
    'bg-surface text-fg border-border shadow-1 hover:bg-surface-sunken hover:border-primary-soft-border',
  ghost: 'bg-transparent text-fg-muted border-transparent hover:bg-primary-soft hover:text-fg',
  danger:
    'bg-danger text-on-primary border-danger shadow-1 hover:bg-danger-hover hover:border-danger-hover',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-control-sm px-2.5 gap-1.5 text-body-sm',
  md: 'min-h-control-md px-3 gap-2 text-body-sm',
  lg: 'min-h-control-lg px-5 gap-2 text-label',
};

export const BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center rounded-md border font-medium whitespace-nowrap ' +
  'transition-colors duration-fast ease-standard select-none focus-visible:focus-ring ' +
  'disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg disabled:border-disabled-bg ' +
  'aria-disabled:cursor-not-allowed aria-disabled:bg-disabled-bg aria-disabled:text-disabled-fg aria-disabled:border-disabled-bg ' +
  'pointer-coarse:min-h-11 pointer-coarse:min-w-11';

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return cn(BUTTON_BASE, VARIANT[variant], SIZE[size]);
}

export type ButtonProps = Omit<ComponentProps<'button'>, 'children'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Yükleniyor durumunda görünen metin (`children` yerine). */
  loadingLabel?: string;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  fullWidth?: boolean;
  render?: ReactElement;
  children?: ReactNode;
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  loadingLabel,
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  render,
  className,
  children,
  onClick,
  type,
  ...rest
}: ButtonProps) {
  const iconSize = 'sm';
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      ...rest,
      type: render === undefined ? (type ?? 'button') : type,
      'aria-busy': loading || undefined,
      className: cn(buttonClasses(variant, size), fullWidth && 'w-full', className),
      onClick: (event: Parameters<NonNullable<ComponentProps<'button'>['onClick']>>[0]) => {
        if (loading || rest['aria-disabled'] === true || rest['aria-disabled'] === 'true') {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      },
      children: (
        <>
          {loading ? (
            <Icon icon="status.loading" size={iconSize} className="motion-safe:animate-spin" />
          ) : (
            leadingIcon && <Icon icon={leadingIcon} size={iconSize} />
          )}
          <span>{loading && loadingLabel ? loadingLabel : children}</span>
          {!loading && trailingIcon && <Icon icon={trailingIcon} size={iconSize} />}
        </>
      ),
    },
  });
}
