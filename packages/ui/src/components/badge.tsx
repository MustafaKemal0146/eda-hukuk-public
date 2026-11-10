// Badge / Chip (052 §3): her zaman sınır taşır; soft zeminde yalnız *-on-soft metin.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';
import { TONE_CLASSES, type Tone } from './tone.ts';

export type BadgeProps = {
  tone?: Tone;
  icon?: IconName;
  size?: 'sm' | 'md';
  mono?: boolean;
  /** `tag` köşeli (radius-sm), `pill` yuvarlak (radius-full). */
  shape?: 'tag' | 'pill';
  className?: string;
  children: ReactNode;
};

export function Badge({
  tone = 'neutral',
  icon,
  size = 'sm',
  mono = false,
  shape = 'tag',
  className,
  children,
}: BadgeProps) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1 border font-medium whitespace-nowrap',
        shape === 'pill' ? 'rounded-full' : 'rounded-sm',
        size === 'sm' ? 'h-5 px-1.5 text-caption' : 'h-6 px-2 text-body-sm',
        mono && 'font-mono',
        TONE_CLASSES[tone].soft,
        className,
      )}
    >
      {icon && <Icon icon={icon} size="sm" />}
      {children}
    </span>
  );
}

/** `Chip` = `Badge` (052 §3 `Badge`/`Chip` tek bileşen). */
export const Chip = Badge;
