// Boş / hata / bildirim kalıpları (052 §3, §13). Metinler çağırandan gelir.
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';
import { TONE_CLASSES } from './tone.ts';

export type EmptyStateProps = {
  icon: IconName;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  actions,
  as: H = 'h2',
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      <span className="mb-2 inline-flex size-10 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted shadow-1">
        <Icon icon={icon} size="md" />
      </span>
      <H className="text-title text-fg">{title}</H>
      {description && <p className="max-w-md text-body-sm text-fg-muted">{description}</p>}
      {actions && <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
const NOTICE_ICON: Record<NoticeTone, IconName> = {
  info: 'notice.info',
  success: 'status.verified',
  warning: 'notice.warning',
  danger: 'notice.error',
  neutral: 'notice.info',
};

export type NoticeBannerProps = {
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  /** Kalıcı bilgi şeridi için role="status"; yeni oluşan hata için "alert". */
  role?: 'status' | 'alert' | 'note';
  className?: string;
};

export function NoticeBanner({
  tone = 'info',
  title,
  children,
  action,
  role = 'note',
  className,
}: NoticeBannerProps) {
  return (
    <div
      role={role === 'note' ? undefined : role}
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5',
        TONE_CLASSES[tone].soft,
        className,
      )}
    >
      <Icon icon={NOTICE_ICON[tone]} size="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 text-body-sm">
        {title && <p className="font-medium">{title}</p>}
        <div>{children}</div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export type LockedFeatureStateProps = {
  title: ReactNode;
  description?: ReactNode;
  /** "Durumu görüntüle" gibi tek eylem (053-01 §9.1). */
  action?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
};

/** Kilitli özellik (052 §3, §13.1): `EmptyState` varyantı; `AUTH_PENDING_VERIFICATION` buna eşlenir. */
export function LockedFeatureState({
  title,
  description,
  action,
  as,
  className,
}: LockedFeatureStateProps) {
  return (
    <EmptyState
      icon="control.locked"
      title={title}
      description={description}
      actions={action}
      {...(as === undefined ? {} : { as })}
      {...(className === undefined ? {} : { className })}
    />
  );
}

export type AlertProps = {
  tone?: NoticeTone;
  title?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** Yalnız dinamik (yeni oluşan) hatada `true`: `role="alert"`. Statik bilgide rol yoktur. */
  live?: boolean;
  className?: string;
};

/** Satır içi ileti (052 §3): form ve kart içinde. Durum simge + metinle verilir. */
export function Alert({
  tone = 'info',
  title,
  children,
  actions,
  live = false,
  className,
}: AlertProps) {
  return (
    <div
      role={live ? 'alert' : undefined}
      data-tone={tone}
      className={cn(
        'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-body-sm',
        TONE_CLASSES[tone].soft,
        className,
      )}
    >
      <Icon icon={NOTICE_ICON[tone]} size="sm" className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
        {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Ortam şeridi (052 §4.1, §5.1): SİMÜLASYON / sentetik ortam. Kalıcıdır, kapatılamaz;
 * DOM'da `<aside role="status">` (051 §4.5: warning ailesi).
 */
export function EnvironmentStrip({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <aside
      role="status"
      data-slot="environment-strip"
      className={cn(
        'flex items-center gap-2 border-b px-4 py-1.5 text-body-sm',
        TONE_CLASSES.warning.soft,
        className,
      )}
    >
      <Icon icon="provider.simulation" size="sm" className="shrink-0" />
      <span className="font-semibold">{title}</span>
      {children && <span className="min-w-0 truncate">{children}</span>}
    </aside>
  );
}
