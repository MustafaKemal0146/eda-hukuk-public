'use client';
// Combobox (052 §3): aramalı seçim. `role=combobox` + `aria-activedescendant` Base UI'dadır.
// `filter` prop'u ZORUNLUDUR (P05.9; varsayılan yok): çağıran Türkçe katlamalı eşleştiriciyi verir.
// `@eda/ui` `@eda/legal`'e bağımlı olamadığından (002 §8) arayüz eşleştirmesi için yalın bir katlama
// yardımcısı burada durur: `tr-TR` küçük harf + NFD işaret silme + `ı` -> `i` ("istanbul" ->
// "İstanbul Barosu"). Kalıcı veri/sorgu normalizasyonu her zaman `@eda/legal` `text` modülündedir.
import { Combobox as Base } from '@base-ui/react/combobox';
import { type ReactNode, useMemo } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';
import { CONTROL_BASE } from './input.tsx';

export type ComboboxOption = { value: string; label: string; disabled?: boolean };

/** Arayüz eşleştirmesi için Türkçe katlama (büyük/küçük harf ve aksan duyarsız). */
export function foldTurkish(text: string): string {
  return text.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

/** Hazır eşleştirici: etiket, sorgunun katlanmış hâlini içeriyorsa eşleşir. */
export function turkishComboboxFilter(option: ComboboxOption, query: string): boolean {
  const q = foldTurkish(query.trim());
  return q === '' || foldTurkish(option.label).includes(q);
}

export type ComboboxProps = {
  options: readonly ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Zorunlu eşleştirici (varsayılan yok). */
  filter: (option: ComboboxOption, query: string) => boolean;
  /** Sonuç yokken görünen metin ("Sonuç yok"). */
  emptyLabel: ReactNode;
  labels: { toggle: string };
  placeholder?: string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  readOnly?: boolean;
  name?: string;
  /** Field tarafından bağlanır. */
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;
  className?: string;
};

const ITEM =
  'flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 text-body-sm text-fg outline-none select-none ' +
  'data-[highlighted]:bg-primary-soft data-[disabled]:text-disabled-fg pointer-coarse:min-h-11';

export function Combobox({
  options,
  value,
  onValueChange,
  filter,
  emptyLabel,
  labels,
  placeholder,
  size = 'md',
  disabled,
  readOnly,
  name,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  required,
  className,
}: ComboboxProps) {
  const selected = useMemo(() => options.find((o) => o.value === value) ?? null, [options, value]);
  return (
    <Base.Root
      items={[...options]}
      value={selected}
      onValueChange={(next: ComboboxOption | null) => onValueChange(next?.value ?? null)}
      filter={(item: ComboboxOption, query: string) => filter(item, query)}
      itemToStringLabel={(item: ComboboxOption) => item.label}
      itemToStringValue={(item: ComboboxOption) => item.value}
      isItemEqualToValue={(a: ComboboxOption, b: ComboboxOption) => a.value === b.value}
      {...(disabled === undefined ? {} : { disabled })}
      {...(readOnly === undefined ? {} : { readOnly })}
      {...(required === undefined ? {} : { required })}
      {...(name === undefined ? {} : { name })}
    >
      <Base.InputGroup className={cn('relative w-full', className)}>
        <Base.Input
          {...(id === undefined ? {} : { id })}
          {...(placeholder === undefined ? {} : { placeholder })}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={cn(
            CONTROL_BASE,
            'pr-10 pl-3',
            size === 'sm' ? 'min-h-control-sm' : 'min-h-control-md',
          )}
        />
        <Base.Trigger
          aria-label={labels.toggle}
          className="absolute top-1/2 right-1 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:bg-primary-soft hover:text-fg focus-visible:focus-ring"
        >
          <Icon icon="control.chevrons-up-down" size="sm" />
        </Base.Trigger>
      </Base.InputGroup>
      <Base.Portal>
        <Base.Positioner sideOffset={4} align="start" className="z-dropdown">
          <Base.Popup className="w-(--anchor-width) min-w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-2 outline-none">
            <Base.Empty className="px-2 py-2 text-body-sm text-fg-muted empty:hidden">
              {emptyLabel}
            </Base.Empty>
            <Base.List className="max-h-80 overflow-y-auto">
              {(item: ComboboxOption) => (
                <Base.Item
                  key={item.value}
                  value={item}
                  {...(item.disabled === undefined ? {} : { disabled: item.disabled })}
                  className={ITEM}
                >
                  <span className="flex-1 truncate">{item.label}</span>
                  <Base.ItemIndicator className="text-primary">
                    <Icon icon="control.check" size="sm" />
                  </Base.ItemIndicator>
                </Base.Item>
              )}
            </Base.List>
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
