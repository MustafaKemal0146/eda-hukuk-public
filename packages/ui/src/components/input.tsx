'use client';
// Input ve Textarea (052 §3): kontrol sınırı border-strong (051 T-6); geçersizde 2 px danger sınır.
// Odak halkası :focus-within ile verilir (:focus-visible değil): Chromium tarih/saat girdisinde klavye
// odağı iç (UA gölge) bölümdedir; kök öğe :focus-visible ve :focus ile eşleşmez (DK-031).
import { type ComponentProps, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export const CONTROL_BASE =
  'w-full rounded-md border border-border-strong bg-surface text-body-sm text-fg shadow-1 ' +
  'placeholder:text-fg-subtle transition-colors duration-fast ease-standard ' +
  'hover:border-fg-muted focus-within:focus-ring focus-within:outline-offset-0 read-only:bg-surface-sunken ' +
  'pointer-coarse:min-h-11 ' +
  'disabled:cursor-not-allowed disabled:bg-disabled-bg disabled:text-disabled-fg ' +
  'aria-invalid:border-2 aria-invalid:border-danger';

export type InputProps = Omit<ComponentProps<'input'>, 'size'> & { size?: 'sm' | 'md' | 'lg' };

const SIZE = {
  sm: 'min-h-control-sm px-2.5',
  md: 'min-h-control-md px-3',
  lg: 'min-h-control-lg px-3.5 text-body',
} as const;

export function Input({ size = 'md', className, ...rest }: InputProps) {
  return <input {...rest} className={cn(CONTROL_BASE, SIZE[size], className)} />;
}

export type TextareaProps = ComponentProps<'textarea'> & {
  /** İçeriğe göre büyür (`maxRows` sınırına kadar). */
  autoGrow?: boolean;
  maxRows?: number;
  /** Çerçevesiz: kendi kabı olan bileşenler için (istem kutusu, arama kartı). Sınıf çakışması olmaz. */
  bare?: boolean;
};

export function Textarea({
  autoGrow = false,
  maxRows = 10,
  bare = false,
  className,
  onInput,
  ...rest
}: TextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = (): void => {
    const el = ref.current;
    if (!autoGrow || el === null) return;
    const line = Number.parseFloat(getComputedStyle(el).lineHeight) || 24;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows + 16)}px`;
  };
  useLayoutEffect(resize);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={rest.rows ?? (autoGrow ? 1 : 3)}
      onInput={(event) => {
        resize();
        onInput?.(event);
      }}
      className={cn(
        bare
          ? 'w-full bg-transparent text-fg placeholder:text-fg-subtle focus-visible:outline-none'
          : [CONTROL_BASE, 'px-3 py-2'],
        autoGrow && 'resize-none',
        className,
      )}
    />
  );
}

export type PasswordInputProps = Omit<InputProps, 'type'> & {
  labels: { show: string; hide: string };
};

/** PasswordInput (052 §3): göster/gizle düğmesi girdinin içinde, `aria-pressed` ile. */
export function PasswordInput({ labels, className, size = 'md', ...rest }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...rest}
        size={size}
        type={visible ? 'text' : 'password'}
        className={cn('pr-10', className)}
      />
      <button
        type="button"
        aria-label={visible ? labels.hide : labels.show}
        aria-pressed={visible}
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-1.5 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:bg-primary-soft hover:text-fg focus-visible:focus-ring pointer-coarse:size-11"
      >
        <Icon icon={visible ? 'control.hide-password' : 'control.show-password'} size="sm" />
      </button>
    </div>
  );
}
