'use client';
// FormErrorSummary (052 §3, 055 §6.2): gönderim hatalarında form başı özet. `role="alert"`; görünür
// olduğunda odak başlığa taşınır; her madde ilgili alana bağlantıdır (`#<alan kimliği>`).
import { type ReactNode, useEffect, useRef } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export type FormErrorItem = { fieldId: string; message: ReactNode };

export function FormErrorSummary({
  title,
  errors,
  className,
}: {
  title: ReactNode;
  errors: readonly FormErrorItem[];
  className?: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const count = errors.length;
  useEffect(() => {
    if (count > 0) headingRef.current?.focus();
  }, [count]);
  if (count === 0) return null;
  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-danger-border bg-danger-soft px-4 py-3 text-danger-on-soft',
        className,
      )}
    >
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-body-sm font-semibold focus-visible:focus-ring"
      >
        <Icon icon="notice.error" size="sm" />
        {title}
      </h2>
      <ul className="mt-2 flex list-disc flex-col gap-1 pl-6 text-body-sm">
        {errors.map((e) => (
          <li key={e.fieldId}>
            <a
              href={`#${e.fieldId}`}
              className="rounded-sm underline underline-offset-2 hover:no-underline focus-visible:focus-ring"
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
