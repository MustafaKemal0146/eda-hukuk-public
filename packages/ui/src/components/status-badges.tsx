// Durum rozetleri (052 §5.4, §6.2, §10, §11; 051 §4.3–§4.6). Hepsi `status-maps.ts` tablolarını okur;
// durum yalnız renkle verilmez (simge + metin + sınır biçimi). Metinler `labels`/`label` ile gelir.
// Yüzde, güven skoru yoktur (Y-72, Y-77).
import type {
  AiProviderId,
  AiProviderRegion,
  CalendarEventType,
  DataClass,
  DocumentStatus,
  FileStatus,
} from '@eda/contracts/enums';
import type { ReactNode } from 'react';
import { Icon } from '../icons/icon.tsx';
import { cn } from './cn.ts';
import { StatusIcon } from './status-icon.tsx';
import {
  CITATION_STATUS_VIEW,
  type CitationStatusView,
  type CitationViewKey,
  DATA_CLASS_VIEW,
  DOCUMENT_STATUS_VIEW,
  EVENT_TYPE_VIEW,
  FILE_STATUS_VIEW,
  type StatusView,
} from './status-maps.ts';
import { TONE_CLASSES } from './tone.ts';

const CHIP_BASE =
  'inline-flex max-w-full items-center gap-1 rounded-sm font-medium whitespace-nowrap';
const CHIP_SIZE = { sm: 'h-5 px-1.5 text-caption', md: 'h-6 px-2 text-body-sm' } as const;

/** Tablo tabanlı ton rozeti (iç yardımcı). */
function ToneStatusBadge({
  view,
  label,
  status,
  size = 'sm',
  className,
}: {
  view: StatusView;
  label: string;
  status: string;
  size?: 'sm' | 'md';
  className?: string | undefined;
}) {
  return (
    <span
      data-status={status}
      data-tone={view.tone}
      className={cn(CHIP_BASE, 'border', CHIP_SIZE[size], TONE_CLASSES[view.tone].soft, className)}
    >
      <StatusIcon icon={view.icon} staticIcon={view.staticIcon} />
      <span className="truncate">{label}</span>
    </span>
  );
}

// --- CitationStatusBadge -------------------------------------------------------------------

export type CitationStatusLabels = Readonly<Record<CitationViewKey, string>>;

export type CitationStatusBadgeProps = {
  status: CitationViewKey;
  /** 8 durum + `unresolved` etiketleri (003 §4.2; katalogdan). */
  labels: CitationStatusLabels;
  /** Bağlama özgü etiket (Künye Kontrolü'nde `out_of_context` için `reason` metni; 053-04 §6.3). */
  contextLabel?: string;
  /** Yalnız simge görünür; erişilebilir ad etiketi taşır. */
  compact?: boolean;
  size?: 'sm' | 'md';
  className?: string;
};

export function CitationStatusBadge({
  status,
  labels,
  contextLabel,
  compact = false,
  size = 'sm',
  className,
}: CitationStatusBadgeProps) {
  const view: CitationStatusView = CITATION_STATUS_VIEW[status];
  const label = contextLabel ?? labels[status];
  const icon = <StatusIcon icon={view.icon} staticIcon={view.staticIcon} />;
  if (compact) {
    return (
      <span
        role="img"
        aria-label={label}
        data-status={status}
        data-frame={view.frame}
        className={cn(
          'inline-flex size-6 shrink-0 items-center justify-center rounded-sm',
          view.className,
          className,
        )}
      >
        {icon}
      </span>
    );
  }
  return (
    <span
      data-status={status}
      data-frame={view.frame}
      className={cn(CHIP_BASE, CHIP_SIZE[size], view.className, className)}
    >
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}

// --- DataClassChip -------------------------------------------------------------------------

export type DataClassChipProps = {
  dataClass: DataClass;
  /** Görünür etiket ("Genel araştırma (kamu)", "Müvekkil işi", "Dosya: <ad>"). */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
};

/** Veri sınıfı çipi (052 §5.4). Kendisi canlı bölge değildir; yükselme `Announcer` ile duyurulur. */
export function DataClassChip({ dataClass, label, size = 'sm', className }: DataClassChipProps) {
  const view = DATA_CLASS_VIEW[dataClass];
  return (
    <span
      data-data-class={dataClass}
      className={cn(CHIP_BASE, 'border', CHIP_SIZE[size], view.className, className)}
    >
      <Icon icon={view.icon} size="sm" className="shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

// --- ProviderBadge -------------------------------------------------------------------------

export type ProviderBadgeProps = {
  /** Bölge yoksa rozet çizilmez (sahte değer yazılmaz; 052 §5.4). */
  region: AiProviderRegion | null | undefined;
  providerId: AiProviderId;
  /** İkincil bilgi: model etiketi (ör. "edai-flash"). */
  modelLabel?: string;
  labels: {
    /** Tam metin: "İşlem yeri: TR (deepseek)". */
    location: string;
    /** `mock` sağlayıcı için kalıcı rozet metni ("SİMÜLASYON"). */
    simulation: string;
  };
  className?: string;
};

/** Sağlayıcı/bölge rozeti (052 §5.4, Y-85): gerçek değer her zaman görünür, gizleme seçeneği yoktur. */
export function ProviderBadge({
  region,
  providerId,
  modelLabel,
  labels,
  className,
}: ProviderBadgeProps) {
  if (region === null || region === undefined) return null;
  return (
    <span
      data-provider={providerId}
      data-region={region}
      className={cn('inline-flex max-w-full flex-wrap items-center gap-1.5', className)}
    >
      <span className={cn(CHIP_BASE, 'border', CHIP_SIZE.sm, TONE_CLASSES.neutral.soft)}>
        <Icon icon="provider.region" size="sm" className="shrink-0" />
        <span className="truncate">{labels.location}</span>
        {modelLabel && <span className="font-mono text-fg-subtle">{modelLabel}</span>}
      </span>
      {providerId === 'mock' && (
        <span
          data-simulation=""
          className={cn(CHIP_BASE, 'border', CHIP_SIZE.sm, TONE_CLASSES.warning.soft)}
        >
          <Icon icon="provider.simulation" size="sm" className="shrink-0" />
          {labels.simulation}
        </span>
      )}
    </span>
  );
}

// --- DocStatusBadge, FileStatusBadge -------------------------------------------------------

export function DocStatusBadge({
  status,
  labels,
  size,
  className,
}: {
  status: DocumentStatus;
  labels: Readonly<Record<DocumentStatus, string>>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <ToneStatusBadge
      view={DOCUMENT_STATUS_VIEW[status]}
      label={labels[status]}
      status={status}
      size={size}
      className={className}
    />
  );
}

export function FileStatusBadge({
  status,
  labels,
  size,
  className,
}: {
  status: FileStatus;
  labels: Readonly<Record<FileStatus, string>>;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <ToneStatusBadge
      view={FILE_STATUS_VIEW[status]}
      label={labels[status]}
      status={status}
      size={size}
      className={className}
    />
  );
}

// --- EventChip -----------------------------------------------------------------------------

export type EventChipProps = {
  type: CalendarEventType;
  /** Tür etiketi ("Duruşma"); simgeyle birlikte görünür. */
  typeLabel: string;
  /** Etkinlik başlığı (görsel olarak kesilebilir). */
  title: ReactNode;
  /** Saat vb. ek bilgi (ör. "09:30"). */
  meta?: ReactNode;
  /** Kesilmemiş tam bilgi ("Duruşma, 09:30, …"); ekran okuyucu bunu okur. */
  accessibleLabel: string;
  className?: string;
};

/** Takvim etkinlik çipi (052 §11, 051 §4.6): soft zemin + sol 4 px kenar + simge + tür etiketi. */
export function EventChip({
  type,
  typeLabel,
  title,
  meta,
  accessibleLabel,
  className,
}: EventChipProps) {
  const view = EVENT_TYPE_VIEW[type];
  return (
    <span
      data-event-type={type}
      className={cn(
        'flex min-h-6 w-full min-w-0 items-center gap-1.5 rounded-sm border border-l-4 px-1.5 text-caption',
        TONE_CLASSES[view.tone].soft,
        className,
      )}
    >
      <span aria-hidden="true" className="contents">
        <Icon icon={view.icon} size="sm" className="shrink-0" />
        <span className="shrink-0 font-medium">{typeLabel}</span>
        {meta && <span className="shrink-0 tabular-nums">{meta}</span>}
        <span className="min-w-0 truncate">{title}</span>
      </span>
      <span className="sr-only">{accessibleLabel}</span>
    </span>
  );
}
