'use client';
// Field (052 §3): etiket + kontrol + açıklama + hata. Kimlikler useId ile bağlanır (aria-describedby).
import { cloneElement, isValidElement, type ReactElement, type ReactNode, useId } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export type FieldProps = {
  label: ReactNode;
  /** Etiketin sağında bağlantı vb. (ör. "Şifremi unuttum"). */
  labelAside?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactElement<Record<string, unknown>>;
};

export function Field({
  label,
  labelAside,
  description,
  error,
  required,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(' ') || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : undefined,
        required,
      })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-body-sm font-medium text-fg">
          {label}
        </label>
        {labelAside}
      </div>
      {control}
      {description && (
        <p id={descId} className="text-caption text-fg-subtle">
          {description}
        </p>
      )}
      {error && (
        <p id={errId} className="flex items-center gap-1 text-body-sm text-danger">
          <Icon icon="notice.error" size="sm" />
          {error}
        </p>
      )}
    </div>
  );
}
