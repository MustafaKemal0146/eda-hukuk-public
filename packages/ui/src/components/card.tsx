// Card (052 §3): düz yüzey + 1 px sınır; etkileşimliyse tek <a>/<button> (render ile).
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn.ts';

export function Card({ className, ...rest }: ComponentProps<'div'>) {
  return (
    <div
      {...rest}
      className={cn('rounded-lg border border-border bg-surface shadow-1', className)}
    />
  );
}

export type CardHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
};

export function CardHeader({
  title,
  description,
  icon,
  actions,
  as: H = 'h2',
  className,
}: CardHeaderProps) {
  return (
    <div className={cn('flex items-start gap-3', className)}>
      {icon}
      <div className="min-w-0 flex-1">
        <H className="text-title text-fg">{title}</H>
        {description && <p className="mt-0.5 text-body-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
