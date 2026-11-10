// Loader (052 §2-§3): küçük dönen gösterge + ZORUNLU metin ("Doğrulanıyor"). Azaltılmış harekette
// statik `clock` simgesi çizilir (051 §10.2). Canlı bölge değildir: tamamlanma `Announcer` ile duyurulur.
import { cn } from './cn.ts';
import { StatusIcon } from './status-icon.tsx';

export function Loader({
  label,
  size = 'sm',
  className,
}: {
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      data-slot="loader"
      className={cn(
        'inline-flex items-center gap-2 text-fg-muted',
        size === 'sm' ? 'text-caption' : 'text-body-sm',
        className,
      )}
    >
      <StatusIcon icon="status.loading" staticIcon="status.loading-static" />
      <span>{label}</span>
    </span>
  );
}
