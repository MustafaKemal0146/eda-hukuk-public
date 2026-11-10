// Marka işareti (051 Açık Soru 1 geçici marka): mürekkep kare içinde serif paragraf işareti (§).
// Süs öğesidir; marka adı her zaman yanında metin olarak verilir.
import { cn } from './cn.ts';

const SIZE = {
  sm: 'size-6 rounded-sm text-body-sm',
  md: 'size-7 rounded-md text-title shadow-1',
  lg: 'size-10 rounded-lg text-heading-md shadow-2',
} as const;

export function BrandMark({
  size = 'md',
  className,
}: {
  size?: keyof typeof SIZE;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-primary font-display leading-none text-on-primary',
        SIZE[size],
        className,
      )}
    >
      §
    </span>
  );
}
