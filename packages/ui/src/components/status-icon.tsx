// İç yardımcı (dışa aktarılmaz): durum simgesi. Dönen simgenin azaltılmış hareketteki statik
// karşılığı aynı yerde çizilir; görünürlük CSS ile seçilir (051 §10.2; JS ile ortam okunmaz).
import { Icon, type IconName } from '../icons/icon.tsx';
import { cn } from './cn.ts';

export function StatusIcon({
  icon,
  staticIcon,
  className,
}: {
  icon: IconName;
  staticIcon?: IconName | undefined;
  className?: string;
}) {
  if (staticIcon === undefined) {
    return <Icon icon={icon} size="sm" className={cn('shrink-0', className)} />;
  }
  return (
    <>
      <Icon
        icon={icon}
        size="sm"
        className={cn('shrink-0 motion-safe:animate-spin motion-reduce:hidden', className)}
      />
      <Icon
        icon={staticIcon}
        size="sm"
        className={cn('hidden shrink-0 motion-reduce:block', className)}
      />
    </>
  );
}
