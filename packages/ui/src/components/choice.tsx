'use client';
// Seçim ilkelleri (052 §3): Switch (durum metinle de verilir), Checkbox, SegmentedControl (radiogroup).
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI Switch.Root bir <button role="switch"> çizer; etiket onu kapsar.
    <label className="flex cursor-pointer items-start justify-between gap-4 pointer-coarse:min-h-11">
      <span className="min-w-0">
        <span className="block text-body-sm font-medium text-fg">{label}</span>
        {description && (
          <span className="mt-0.5 block text-body-sm text-fg-muted">{description}</span>
        )}
      </span>
      <BaseSwitch.Root
        checked={checked}
        onCheckedChange={(v: boolean) => onCheckedChange(v)}
        disabled={disabled}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border-strong bg-surface-sunken',
          'transition-colors duration-fast focus-visible:focus-ring data-[checked]:border-primary data-[checked]:bg-primary',
        )}
      >
        <BaseSwitch.Thumb className="ml-0.5 size-3.5 rounded-full border border-border-strong bg-surface shadow-1 transition-transform duration-fast data-[checked]:translate-x-4 data-[checked]:border-surface" />
      </BaseSwitch.Root>
    </label>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Base UI Checkbox.Root bir <button role="checkbox"> çizer; etiket onu kapsar.
    <label className="inline-flex min-h-6 cursor-pointer items-center gap-2 text-body-sm text-fg pointer-coarse:min-h-11">
      <BaseCheckbox.Root
        checked={checked}
        onCheckedChange={(v: boolean) => onCheckedChange(v)}
        disabled={disabled}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border border-border-strong bg-surface shadow-1 focus-visible:focus-ring data-[checked]:border-primary data-[checked]:bg-primary"
      >
        <BaseCheckbox.Indicator className="text-on-primary">
          <Icon icon="control.check" size="sm" />
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      {label}
    </label>
  );
}

export type SegmentOption<V extends string> = { value: V; label: string; icon?: IconName };

export function SegmentedControl<V extends string>({
  value,
  onValueChange,
  options,
  label,
}: {
  value: V;
  onValueChange: (value: V) => void;
  options: readonly SegmentOption<V>[];
  label: string;
}) {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      onValueChange={(v: unknown) => onValueChange(v as V)}
      className="inline-flex gap-0.5 rounded-md border border-border bg-neutral-soft p-0.5"
    >
      {options.map((o) => (
        <Radio.Root
          key={o.value}
          value={o.value}
          className={cn(
            'inline-flex min-h-7 items-center gap-1.5 rounded-sm px-2.5 text-body-sm font-medium text-fg-muted pointer-coarse:min-h-11',
            'hover:text-fg focus-visible:focus-ring data-[checked]:bg-surface data-[checked]:text-fg data-[checked]:shadow-1',
          )}
        >
          {o.icon && <Icon icon={o.icon} size="sm" />}
          {o.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}
