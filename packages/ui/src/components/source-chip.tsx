// SourceChip (052 §6.1-§6.2): kısa künye çipi. Künye metni DB/akış kaydından gelir, model yazmaz.
// Durum simge + ton + sınır biçimiyle verilir (yalnız renk değil); erişilebilir ad çağırandan gelir
// ("Kaynak: {künye}. Durum: {etiket}."). Etkileşimliyse `onActivate` ile düğme olur.
import type { KunyeStatus } from '@eda/contracts/enums';
import { cn } from './cn.ts';
import { StatusIcon } from './status-icon.tsx';
import {
  CITATION_NO_STATUS_VIEW,
  CITATION_STATUS_VIEW,
  type CitationStatusView,
} from './status-maps.ts';

export type SourceChipProps = {
  shortKunye: string;
  /** Akış sürerken (durum gelmeden) nötr çip. */
  status?: KunyeStatus;
  /** Erişilebilir ad; boşsa yalnız künye okunur. */
  label?: string;
  /** Künye yanında görünen kaynak bilgisi (portal adı, erişim tarihi); çağırandan gelir. */
  meta?: string;
  onActivate?: () => void;
  className?: string;
};

export function SourceChip({
  shortKunye,
  status,
  label,
  meta,
  onActivate,
  className,
}: SourceChipProps) {
  // Görünüm tek tablodan (status-maps.ts); sınır biçimi sınıfı tablodadır (052 §6.2).
  const look: CitationStatusView = status ? CITATION_STATUS_VIEW[status] : CITATION_NO_STATUS_VIEW;
  const classes = cn(
    'inline-flex h-6 max-w-full items-center gap-1.5 rounded-sm pr-2 pl-1.5 align-middle font-mono text-caption whitespace-nowrap',
    look.className,
    onActivate &&
      'cursor-pointer transition-colors duration-fast hover:shadow-1 focus-visible:focus-ring',
    className,
  );
  const body = (
    <>
      <StatusIcon icon={look.icon} staticIcon={look.staticIcon} />
      <span className="truncate">{shortKunye}</span>
      {meta ? (
        <span data-slot="chip-meta" className="truncate font-normal">
          · {meta}
        </span>
      ) : null}
    </>
  );
  if (onActivate) {
    return (
      <button
        type="button"
        data-slot="chip"
        data-status={status}
        aria-label={label}
        onClick={onActivate}
        className={classes}
      >
        {body}
      </button>
    );
  }
  return (
    <span data-slot="chip" data-status={status} className={classes}>
      {label ? (
        <>
          <span aria-hidden="true" className="contents">
            {body}
          </span>
          <span className="sr-only">{label}</span>
        </>
      ) : (
        body
      )}
    </span>
  );
}
