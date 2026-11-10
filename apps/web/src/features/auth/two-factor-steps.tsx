// Kurulum adım göstergesi (053-01 §4.2): "Adım n/3" görünür metni + erişilebilir `ol` listesi
// (`aria-current="step"`). Tamamlanan adım simge + metinle gösterilir; yalnız renk kullanılmaz.
import { Stepper, type StepperStep, type StepStatus } from '@eda/ui';
import { useTranslations } from 'next-intl';

export const SETUP_STEPS = ['install', 'scan', 'code'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

/** `done`: yedek kodlar aşamasında üç adım da tamamlanmış sayılır. */
export function SetupSteps({ current }: { current: SetupStep | 'done' }) {
  const t = useTranslations('auth.twoFactor.setup');
  const at = current === 'done' ? SETUP_STEPS.length : SETUP_STEPS.indexOf(current);
  const steps: StepperStep[] = SETUP_STEPS.map((key, i) => {
    const status: StepStatus = i < at ? 'complete' : i === at ? 'current' : 'pending';
    return { label: t(`stepNames.${key}`), status };
  });
  return (
    <div className="flex flex-col gap-3">
      {current !== 'done' && (
        <p className="text-caption font-semibold text-fg-subtle">
          {t('stepCounter', { n: at + 1, total: SETUP_STEPS.length })}
        </p>
      )}
      <Stepper
        steps={steps}
        label={t('stepsLabel')}
        statusLabels={{
          complete: t('stepStatus.complete'),
          current: t('stepStatus.current'),
          pending: t('stepStatus.pending'),
          error: t('stepStatus.error'),
        }}
      />
    </div>
  );
}
