'use client';
// DropdownMenu (052 §3): Base UI Menu; ok tuşları, Esc, odağın tetikleyiciye dönüşü Base UI'dadır.
import { Menu } from '@base-ui/react/menu';
import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

const POPUP =
  'z-dropdown min-w-52 rounded-lg border border-border bg-surface-raised p-1 shadow-2 focus-visible:outline-none';
const ITEM =
  'flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 text-body-sm text-fg outline-none ' +
  'data-[highlighted]:bg-primary-soft data-[disabled]:text-disabled-fg pointer-coarse:min-h-11';

export type DropdownMenuProps = {
  trigger: ReactElement;
  align?: 'start' | 'center' | 'end';
  children: ReactNode;
};

export function DropdownMenu({ trigger, align = 'end', children }: DropdownMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger render={trigger} />
      <Menu.Portal>
        <Menu.Positioner sideOffset={8} align={align} className="z-dropdown">
          <Menu.Popup className={POPUP}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function DropdownMenuItem({
  icon,
  onSelect,
  render,
  tone = 'default',
  children,
}: {
  icon?: IconName;
  onSelect?: () => void;
  render?: ReactElement;
  tone?: 'default' | 'danger';
  children: ReactNode;
}) {
  return (
    <Menu.Item
      onClick={onSelect}
      render={render}
      className={cn(ITEM, tone === 'danger' && 'text-danger')}
    >
      {icon && <Icon icon={icon} size="sm" />}
      <span className="flex-1">{children}</span>
    </Menu.Item>
  );
}

export function DropdownMenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-2 pb-1 text-caption font-medium text-fg-subtle">{children}</div>;
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="my-1 h-px bg-border" />;
}

export function DropdownMenuRadioGroup<V extends string>({
  value,
  onValueChange,
  options,
}: {
  value: V;
  onValueChange: (value: V) => void;
  options: readonly { value: V; label: string; icon?: IconName }[];
}) {
  return (
    <Menu.RadioGroup value={value} onValueChange={(v: unknown) => onValueChange(v as V)}>
      {options.map((o) => (
        <Menu.RadioItem key={o.value} value={o.value} closeOnClick className={ITEM}>
          {o.icon && <Icon icon={o.icon} size="sm" />}
          <span className="flex-1">{o.label}</span>
          <Menu.RadioItemIndicator className="text-primary">
            <Icon icon="status.verified" size="sm" />
          </Menu.RadioItemIndicator>
        </Menu.RadioItem>
      ))}
    </Menu.RadioGroup>
  );
}
