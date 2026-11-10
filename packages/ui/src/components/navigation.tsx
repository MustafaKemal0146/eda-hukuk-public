'use client';
// Gezinme ilkelleri (052 §4.1): SkipLinks (DOM'da ilk), NavItem (aktif / ray kipi; render ile Next Link).
import { useRender } from '@base-ui/react/use-render';
import type { ReactElement, ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export function SkipLinks({ links }: { links: readonly { href: string; label: string }[] }) {
  return (
    <div className="contents">
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className="sr-only z-skip-link rounded-md bg-primary px-4 py-2 text-label text-on-primary focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus-visible:focus-ring"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

export type NavItemProps = {
  icon: IconName;
  label: string;
  active?: boolean;
  /** Ray kipinde yalnız simge görünür; ad aria-label ile verilir. */
  rail?: boolean;
  badge?: ReactNode;
  render: ReactElement;
};

export function NavItem({
  icon,
  label,
  active = false,
  rail = false,
  badge,
  render,
}: NavItemProps) {
  return useRender({
    render,
    props: {
      'aria-current': active ? 'page' : undefined,
      'aria-label': rail ? label : undefined,
      className: cn(
        'group flex min-h-sidebar-item items-center gap-2.5 rounded-md px-2 text-body-sm transition-colors duration-fast',
        'focus-visible:focus-ring-inset pointer-coarse:min-h-11',
        active
          ? 'bg-primary-soft font-medium text-fg'
          : 'text-fg-muted hover:bg-primary-soft hover:text-fg',
        rail && 'justify-center px-0',
      ),
      children: (
        <>
          <Icon
            icon={icon}
            size="sm"
            className={active ? 'text-fg' : 'text-fg-subtle group-hover:text-fg'}
          />
          {!rail && <span className="flex-1 truncate">{label}</span>}
          {!rail && badge}
        </>
      ),
    },
  });
}
