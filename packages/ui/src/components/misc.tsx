// Küçük gösterim ilkelleri (052 §3): Separator, Kbd, Avatar, Skeleton, Progress, IconTile.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';
import { TONE_CLASSES, type Tone } from './tone.ts';

export function Separator({
  className,
  vertical = false,
}: {
  className?: string;
  vertical?: boolean;
}) {
  return (
    <hr
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      className={cn('border-0 bg-border', vertical ? 'h-full w-px' : 'h-px w-full', className)}
    />
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface px-1 font-mono text-caption text-fg-subtle shadow-1',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Avatar({
  initials,
  label,
  size = 'md',
}: {
  initials: string;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full border border-border bg-neutral-soft font-medium text-neutral-on-soft',
        size === 'sm' ? 'size-7 text-caption' : 'size-9 text-body-sm',
      )}
    >
      {initials}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('rounded-md bg-surface-sunken', className)} />;
}

export function Progress({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="h-1.5 w-full overflow-hidden rounded-full bg-primary-soft"
    >
      <svg
        className="h-full w-full"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect width={`${pct}%`} height="100%" className="fill-primary" />
      </svg>
    </div>
  );
}

/** Yuvarlatılmış kare içinde simge: kart ve başlık işaretleri için. */
export function IconTile({
  icon,
  tone = 'primary',
  size = 'md',
}: {
  icon: IconName;
  tone?: Tone;
  size?: 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-md border',
        size === 'lg' ? 'size-10' : 'size-8',
        TONE_CLASSES[tone].soft,
      )}
    >
      <Icon icon={icon} size={size === 'lg' ? 'md' : 'sm'} />
    </span>
  );
}
