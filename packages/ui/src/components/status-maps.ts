// Durum -> görünüm tabloları (052 §1.3, §6.2; 051 §4.3–§4.6). Tek sabit kaynak: rozetler ve çipler
// bu tabloları okur; sınıf adları TAM dizedir (Tailwind taraması dinamik birleştirmeyi görmez).
// Anahtarlar `@eda/contracts/enums` sözlüklerinden gelir; `satisfies Record<…>` eksik/fazla anahtarı
// derleme hatasına çevirir. Etiket metni tabloya YAZILMAZ: bileşenler etiketi `labels` ile alır.
import {
  type CalendarEventType,
  type DataClass,
  type DeadlineCheckStatus,
  type DocumentExportStatus,
  type DocumentStatus,
  type FileStatus,
  KUNYE_STATUSES,
  type KunyeStatus,
  type MessageStatus,
  type PipelineStatus,
  type SuggestionStatus,
} from '@eda/contracts/enums';
import type { IconName } from '../icons/icon.tsx';
import type { Tone } from './tone.ts';

/** Ortak durum görünümü: simge + ton; dönen simgenin azaltılmış hareketteki statik karşılığı. */
export type StatusView = {
  readonly icon: IconName;
  readonly tone: Tone;
  /** Varsa `icon` döner (yükleniyor); azaltılmış harekette yerine bu simge çizilir (051 §10.2). */
  readonly staticIcon?: IconName;
};

// --- Künye durumu (052 §6.2, 051 §4.3) -------------------------------------------------------

/** Künye çipi/rozetinin görünüm anahtarları: 8 kanonik durum + çözülemeyen etiket. */
export const CITATION_VIEW_KEYS = [...KUNYE_STATUSES, 'unresolved'] as const;
export type CitationViewKey = KunyeStatus | 'unresolved';

/** Sınır biçimi: 1 px düz, 1 px kesikli, 2 px düz (kalın yazı), dolu (zemin = sınır). */
export type CitationFrame = 'solid' | 'dashed' | 'thick' | 'filled';
/** Dışa aktarım engeli (025 §10): `null` = sonuç beklenir (`pending`). */
export type CitationBlocking = 'none' | 'soft' | 'hard';

export type CitationStatusView = StatusView & {
  readonly frame: CitationFrame;
  readonly blocking: CitationBlocking | null;
  /** Zemin + metin + sınır rengi + sınır biçimi (tam sınıf dizesi). */
  readonly className: string;
};

export const CITATION_STATUS_VIEW = {
  pending: {
    icon: 'citation.pending',
    staticIcon: 'citation.pending-static',
    tone: 'info',
    frame: 'solid',
    blocking: null,
    className:
      'border bg-citation-pending-bg text-citation-pending-fg border-citation-pending-border',
  },
  verified: {
    icon: 'citation.verified',
    tone: 'success',
    frame: 'solid',
    blocking: 'none',
    className:
      'border bg-citation-verified-bg text-citation-verified-fg border-citation-verified-border',
  },
  verified_user_source: {
    icon: 'citation.verified-user-source',
    tone: 'success',
    frame: 'dashed',
    blocking: 'none',
    className:
      'border border-dashed bg-citation-verified-user-source-bg text-citation-verified-user-source-fg border-citation-verified-user-source-border',
  },
  out_of_context: {
    icon: 'citation.out-of-context',
    tone: 'warning',
    frame: 'solid',
    blocking: 'none',
    className:
      'border bg-citation-out-of-context-bg text-citation-out-of-context-fg border-citation-out-of-context-border',
  },
  out_of_coverage: {
    icon: 'citation.out-of-coverage',
    tone: 'neutral',
    frame: 'solid',
    blocking: 'none',
    className:
      'border bg-citation-out-of-coverage-bg text-citation-out-of-coverage-fg border-citation-out-of-coverage-border',
  },
  source_unavailable: {
    icon: 'citation.source-unavailable',
    tone: 'warning',
    frame: 'dashed',
    blocking: 'soft',
    className:
      'border border-dashed bg-citation-source-unavailable-bg text-citation-source-unavailable-fg border-citation-source-unavailable-border',
  },
  not_found: {
    icon: 'citation.not-found',
    tone: 'danger',
    frame: 'thick',
    blocking: 'hard',
    className:
      'border-2 font-semibold bg-citation-not-found-bg text-citation-not-found-fg border-citation-not-found-border',
  },
  attested: {
    icon: 'citation.attested',
    tone: 'inverse',
    frame: 'filled',
    blocking: 'none',
    className:
      'border bg-citation-attested-bg text-citation-attested-fg border-citation-attested-border',
  },
  unresolved: {
    icon: 'citation.unresolved',
    tone: 'neutral',
    frame: 'solid',
    blocking: null,
    className: 'border bg-neutral-soft text-neutral-on-soft border-neutral-border',
  },
} as const satisfies Record<CitationViewKey, CitationStatusView>;

/** Durum henüz gelmemiş (akış sürüyor) çip görünümü (052 §6.1). */
export const CITATION_NO_STATUS_VIEW = {
  icon: 'citation.no-status',
  tone: 'neutral',
  frame: 'solid',
  blocking: null,
  className: 'border bg-neutral-soft text-neutral-on-soft border-neutral-border',
} as const satisfies CitationStatusView;

// --- Veri sınıfı (051 §4.4, 052 §5.4) --------------------------------------------------------

export const DATA_CLASS_VIEW = {
  public: {
    icon: 'data-class.public',
    tone: 'neutral',
    className: 'bg-data-class-public-bg text-data-class-public-fg border-data-class-public-border',
  },
  client: {
    icon: 'data-class.client',
    tone: 'primary',
    className: 'bg-data-class-client-bg text-data-class-client-fg border-data-class-client-border',
  },
  case: {
    icon: 'data-class.case',
    tone: 'violet',
    className: 'bg-data-class-case-bg text-data-class-case-fg border-data-class-case-border',
  },
} as const satisfies Record<DataClass, StatusView & { className: string }>;

// --- Belge, evrak, mesaj, aşama, Süre Kilidi, öneri, dışa aktarım (051 §4.5) -----------------

export const DOCUMENT_STATUS_VIEW = {
  draft: { icon: 'document.draft', tone: 'neutral' },
  review_pending: { icon: 'document.review-pending', tone: 'warning' },
  approved: { icon: 'document.approved', tone: 'success' },
  exported: { icon: 'document.exported', tone: 'info' },
  filed_declared: { icon: 'document.filed-declared', tone: 'info' },
  archived: { icon: 'document.archived', tone: 'neutral' },
} as const satisfies Record<DocumentStatus, StatusView>;

const FILE_PROCESSING = {
  icon: 'file.processing',
  staticIcon: 'file.processing-static',
  tone: 'info',
} as const satisfies StatusView;

export const FILE_STATUS_VIEW = {
  uploaded: FILE_PROCESSING,
  scanning: FILE_PROCESSING,
  extracting: FILE_PROCESSING,
  chunking: FILE_PROCESSING,
  embedding: FILE_PROCESSING,
  ready: { icon: 'file.ready', tone: 'success' },
  failed: { icon: 'file.failed', tone: 'danger' },
  quarantined: { icon: 'file.quarantined', tone: 'danger' },
  ocr_skipped: { icon: 'file.ocr-skipped', tone: 'warning' },
} as const satisfies Record<FileStatus, StatusView>;

/** `complete` rozet taşımaz (051 §4.5; kalıcı "tamamlandı" rozeti yok). */
export const MESSAGE_STATUS_VIEW = {
  streaming: { icon: 'message.streaming', staticIcon: 'status.loading-static', tone: 'info' },
  complete: null,
  stopped: { icon: 'message.stopped', tone: 'neutral' },
  interrupted: { icon: 'message.interrupted', tone: 'warning' },
  error: { icon: 'message.error', tone: 'danger' },
} as const satisfies Record<MessageStatus, StatusView | null>;

export const PIPELINE_STATUS_VIEW = {
  started: { icon: 'status.loading', staticIcon: 'status.loading-static', tone: 'info' },
  progress: { icon: 'status.loading', staticIcon: 'status.loading-static', tone: 'info' },
  done: { icon: 'tone.success', tone: 'success' },
  skipped: { icon: 'tone.neutral', tone: 'neutral' },
  error: { icon: 'tone.danger', tone: 'danger' },
} as const satisfies Record<PipelineStatus, StatusView>;

export const DEADLINE_CHECK_VIEW = {
  match: { icon: 'deadline-check.match', tone: 'success' },
  mismatch: { icon: 'deadline-check.mismatch', tone: 'danger' },
  no_calculation: { icon: 'deadline-check.no-calculation', tone: 'warning' },
} as const satisfies Record<DeadlineCheckStatus, StatusView>;

export const SUGGESTION_STATUS_VIEW = {
  pending: { icon: 'suggestion.pending', tone: 'info' },
  accepted: { icon: 'tone.success', tone: 'success' },
  rejected: { icon: 'tone.neutral', tone: 'neutral' },
  stale: { icon: 'suggestion.stale', tone: 'warning' },
} as const satisfies Record<SuggestionStatus, StatusView>;

export const EXPORT_STATUS_VIEW = {
  queued: { icon: 'status.loading', staticIcon: 'status.loading-static', tone: 'info' },
  processing: { icon: 'status.loading', staticIcon: 'status.loading-static', tone: 'info' },
  ready: { icon: 'tone.success', tone: 'success' },
  failed: { icon: 'tone.danger', tone: 'danger' },
  expired: { icon: 'tone.neutral', tone: 'neutral' },
} as const satisfies Record<DocumentExportStatus, StatusView>;

// --- Takvim etkinlik türü ve süre aciliyeti (051 §4.6) ---------------------------------------

/** Etkinlik türü renkle değil simge + etiketle ayrışır; ton ikincil ipucudur. */
export const EVENT_TYPE_VIEW = {
  hearing: { icon: 'event.hearing', tone: 'primary' },
  deadline: { icon: 'event.deadline', tone: 'danger' },
  discovery: { icon: 'event.discovery', tone: 'info' },
  expert: { icon: 'event.expert', tone: 'violet' },
  meeting: { icon: 'event.meeting', tone: 'success' },
  mediation: { icon: 'event.mediation', tone: 'teal' },
  task: { icon: 'event.task', tone: 'neutral' },
} as const satisfies Record<CalendarEventType, StatusView>;

/** Süre aciliyeti kademeleri (051 §4.6). Eşikler `calendar.urgentDays` / `soonDays` yapılandırmasından. */
export const DEADLINE_URGENCIES = ['overdue', 'urgent', 'soon', 'normal'] as const;
export type DeadlineUrgency = (typeof DEADLINE_URGENCIES)[number];

export const DEADLINE_URGENCY_VIEW = {
  overdue: { icon: 'tone.danger', tone: 'danger' },
  urgent: { icon: 'event.deadline', tone: 'danger' },
  soon: { icon: 'event.deadline', tone: 'warning' },
  normal: { icon: 'event.deadline', tone: 'neutral' },
} as const satisfies Record<DeadlineUrgency, StatusView>;

/** Kalan gün -> aciliyet. Eşikler çağırandan gelir (ölçülmemiş sayı koda gömülmez). */
export function deadlineUrgency(
  daysLeft: number,
  thresholds: { urgentDays: number; soonDays: number },
): DeadlineUrgency {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft <= thresholds.urgentDays) return 'urgent';
  if (daysLeft <= thresholds.soonDays) return 'soon';
  return 'normal';
}
