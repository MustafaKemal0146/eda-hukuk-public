// Icon: semantik ad -> Lucide SVG (051 §11; 052 §3 `Icon`). Renk `currentColor`.
// Süs simgesi varsayılan olarak `aria-hidden`; anlam taşıyorsa `label` verilir (role="img").
import { ICON_REGISTRY, type IconName } from './registry.ts';

export type { IconName };

export type IconSize = 'sm' | 'md' | 'lg' | 'xl';

/** Piksel boyutları: sm 16 (çip, satır içi), md 20 (düğme, gezinme), lg 24 (başlık), xl 40 (boş durum). */
export const ICON_SIZE_PX = Object.freeze({ sm: 16, md: 20, lg: 24, xl: 40 } as const);

/** Çizgi kalınlığı: 16-24 px için 2, 40 px için 1.5. */
export const ICON_STROKE_WIDTH = Object.freeze({ sm: 2, md: 2, lg: 2, xl: 1.5 } as const);

type IconBaseProps = {
  icon: IconName;
  size?: IconSize;
  /** Yalnız yerleşim sınıfları (052 §1.2). */
  className?: string;
};

/** Anlam taşıyan simge: erişilebilir ad zorunlu. */
type LabelledIconProps = IconBaseProps & { label: string; decorative?: false };

/** Süs simgesi (varsayılan): ekran okuyucudan gizlenir. */
type DecorativeIconProps = IconBaseProps & { label?: undefined; decorative?: true };

export type IconProps = LabelledIconProps | DecorativeIconProps;

export function Icon({ icon, size = 'md', className, label }: IconProps) {
  const Component = ICON_REGISTRY[icon];
  const a11y =
    label === undefined
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': label } as const);
  return (
    <Component
      size={ICON_SIZE_PX[size]}
      strokeWidth={ICON_STROKE_WIDTH[size]}
      focusable="false"
      className={className}
      {...a11y}
    />
  );
}
