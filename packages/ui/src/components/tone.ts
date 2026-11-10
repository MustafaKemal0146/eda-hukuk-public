// Ton sınıfı tablosu (052 §1.3): tek tanım. Çip ve rozetler her zaman sınır taşır (051 §13.3).
export const TONES = [
  'neutral',
  'primary',
  'success',
  'warning',
  'danger',
  'info',
  'violet',
  'teal',
  'inverse',
] as const;
export type Tone = (typeof TONES)[number];

export const TONE_CLASSES = {
  neutral: {
    solid: 'text-fg-muted',
    soft: 'bg-neutral-soft text-neutral-on-soft border-neutral-border',
    icon: 'text-fg-muted',
  },
  primary: {
    solid: 'text-primary',
    soft: 'bg-primary-soft text-primary-soft-fg border-primary-soft-border',
    icon: 'text-primary',
  },
  success: {
    solid: 'text-success',
    soft: 'bg-success-soft text-success-on-soft border-success-border',
    icon: 'text-success',
  },
  warning: {
    solid: 'text-warning',
    soft: 'bg-warning-soft text-warning-on-soft border-warning-border',
    icon: 'text-warning',
  },
  danger: {
    solid: 'text-danger',
    soft: 'bg-danger-soft text-danger-on-soft border-danger-border',
    icon: 'text-danger',
  },
  info: {
    solid: 'text-info',
    soft: 'bg-info-soft text-info-on-soft border-info-border',
    icon: 'text-info',
  },
  violet: {
    solid: 'text-violet-on-soft',
    soft: 'bg-violet-soft text-violet-on-soft border-violet-border',
    icon: 'text-violet-on-soft',
  },
  teal: {
    solid: 'text-teal-on-soft',
    soft: 'bg-teal-soft text-teal-on-soft border-teal-border',
    icon: 'text-teal-on-soft',
  },
  inverse: {
    solid: 'text-inverse-fg',
    soft: 'bg-inverse-bg text-inverse-fg border-inverse-bg',
    icon: 'text-inverse-fg',
  },
} as const satisfies Record<Tone, { solid: string; soft: string; icon: string }>;
