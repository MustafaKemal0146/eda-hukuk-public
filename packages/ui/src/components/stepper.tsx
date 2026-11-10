// Stepper (052 §3): adım göstergesi (onboarding, dışa aktarım, Künye Kontrolü). `<ol>`; etkin adım
// `aria-current="step"`. Durum yalnız renkle verilmez: simge + görünür durum metni (`labels`).
import type { ReactNode } from 'react';
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export const STEP_STATUSES = ['complete', 'current', 'pending', 'error'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export type StepperStep = { label: ReactNode; description?: ReactNode; status: StepStatus };

const MARKER: Record<StepStatus, string> = {
  complete: 'border-success-border bg-success-soft text-success-on-soft',
  current: 'border-primary bg-primary text-on-primary',
  pending: 'border-border-strong bg-surface text-fg-subtle',
  error: 'border-danger-border bg-danger-soft text-danger-on-soft',
};

const ICON: Partial<Record<StepStatus, IconName>> = {
  complete: 'control.check',
  error: 'notice.error',
};

export function Stepper({
  steps,
  label,
  statusLabels,
  orientation = 'horizontal',
  className,
}: {
  steps: readonly StepperStep[];
  /** Liste erişilebilir adı ("Adımlar"). */
  label: string;
  /** Görünür durum metinleri ("Tamamlandı", "Etkin", "Bekliyor", "Hata"). */
  statusLabels: Readonly<Record<StepStatus, string>>;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}) {
  return (
    <ol
      aria-label={label}
      className={cn(
        'flex gap-4',
        orientation === 'horizontal' ? 'flex-col sm:flex-row sm:items-start' : 'flex-col',
        className,
      )}
    >
      {steps.map((step, i) => {
        const icon = ICON[step.status];
        return (
          <li
            key={i}
            aria-current={step.status === 'current' ? 'step' : undefined}
            data-status={step.status}
            className="flex min-w-0 flex-1 items-start gap-2.5"
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-caption font-semibold tabular-nums',
                MARKER[step.status],
              )}
            >
              {icon ? <Icon icon={icon} size="sm" /> : i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  'block text-body-sm',
                  step.status === 'current' ? 'font-semibold text-fg' : 'font-medium text-fg',
                )}
              >
                {step.label}
              </span>
              <span
                className={cn(
                  'block text-caption',
                  step.status === 'error' ? 'text-danger' : 'text-fg-subtle',
                )}
              >
                {statusLabels[step.status]}
              </span>
              {step.description && (
                <span className="mt-0.5 block text-caption text-fg-muted">{step.description}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
