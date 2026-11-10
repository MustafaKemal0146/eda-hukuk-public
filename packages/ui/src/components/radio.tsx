'use client';
// RadioGroup + RadioCard (052 §3): tekli seçim. Grup `fieldset/legend` ile adlandırılır; ok tuşları
// seçenekler arasında gezer (Base UI). `options` verilirse yalın radyo listesi çizilir; açıklamalı
// büyük seçenekler için çocuk olarak `RadioCard` kullanılır (yerleşim politikası, paket).
import { Radio } from '@base-ui/react/radio';
import { RadioGroup as BaseRadioGroup } from '@base-ui/react/radio-group';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';

export type RadioOption<V extends string> = {
  value: V;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type RadioGroupProps<V extends string> = {
  legend: ReactNode;
  /** Görsel olarak gizli başlık (erişilebilir ad korunur). */
  hideLegend?: boolean;
  description?: ReactNode;
  value: V;
  onValueChange: (value: V) => void;
  options?: readonly RadioOption<V>[];
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  name?: string;
  className?: string;
  children?: ReactNode;
};

const DOT =
  'inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface shadow-1 ' +
  'data-[checked]:border-primary data-[disabled]:bg-disabled-bg';

export function RadioGroup<V extends string>({
  legend,
  hideLegend = false,
  description,
  value,
  onValueChange,
  options,
  orientation = 'vertical',
  disabled,
  name,
  className,
  children,
}: RadioGroupProps<V>) {
  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend className={cn('mb-2 p-0 text-body-sm font-medium text-fg', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      {description && <p className="-mt-1 mb-3 text-caption text-fg-subtle">{description}</p>}
      <BaseRadioGroup
        value={value}
        onValueChange={(v: unknown) => onValueChange(v as V)}
        {...(disabled === undefined ? {} : { disabled })}
        {...(name === undefined ? {} : { name })}
        className={cn('flex gap-3', orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap')}
      >
        {options?.map((o) => (
          // biome-ignore lint/a11y/noLabelWithoutControl: Base UI Radio.Root bir <button role="radio"> çizer; etiket onu kapsar.
          <label
            key={o.value}
            className="inline-flex cursor-pointer items-start gap-2 text-body-sm text-fg pointer-coarse:min-h-11 has-data-[disabled]:cursor-not-allowed has-data-[disabled]:text-disabled-fg"
          >
            <Radio.Root
              value={o.value}
              {...(o.disabled === undefined ? {} : { disabled: o.disabled })}
              className={cn(DOT, 'mt-0.5 focus-visible:focus-ring')}
            >
              <Radio.Indicator className="size-2 rounded-full bg-primary" />
            </Radio.Root>
            <span className="min-w-0">
              <span className="block">{o.label}</span>
              {o.description && (
                <span className="mt-0.5 block text-caption text-fg-subtle">{o.description}</span>
              )}
            </span>
          </label>
        ))}
        {children}
      </BaseRadioGroup>
    </fieldset>
  );
}

export type RadioCardProps<V extends string> = {
  value: V;
  title: ReactNode;
  description?: ReactNode;
  /** Sağ üstte ikincil bilgi (fiyat, rozet). */
  aside?: ReactNode;
  disabled?: boolean;
};

/** Açıklamalı büyük seçenek; seçili kartta `primary-soft` zemin + `primary` sınır (052 §1.4). */
export function RadioCard<V extends string>({
  value,
  title,
  description,
  aside,
  disabled,
}: RadioCardProps<V>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI Radio.Root bir <button role="radio"> çizer; etiket onu kapsar.
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-1',
        'transition-colors duration-fast hover:border-border-strong',
        'has-data-[checked]:border-primary has-data-[checked]:bg-primary-soft',
        'has-focus-visible:focus-ring has-data-[disabled]:cursor-not-allowed has-data-[disabled]:bg-disabled-bg',
      )}
    >
      <Radio.Root
        value={value}
        {...(disabled === undefined ? {} : { disabled })}
        className={cn(DOT, 'mt-0.5 outline-none')}
      >
        <Radio.Indicator className="size-2 rounded-full bg-primary" />
      </Radio.Root>
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-body-sm font-medium text-fg">{title}</span>
          {aside}
        </span>
        {description && (
          <span className="mt-1 block text-body-sm text-fg-muted">{description}</span>
        )}
      </span>
    </label>
  );
}
