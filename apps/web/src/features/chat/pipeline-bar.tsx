'use client';
// PipelineBar (052 §5.7; 053-02 §5.4): asistan mesajının üstünde ajan hattı. Akışta üst satır çalışan
// işleri (paralel araçlar dahil) ve "N adım · X sn" süresini gösterir; liste satır başına durum,
// sunucu etiketi, ayrıntı (künye) ve süre verir. Tur kapanınca tek satır özete katlanır (tıklanınca
// açılır); kalıcı "Yanıt tamamlandı" rozeti çizilmez. Azaltılmış harekette dönen simge statiktir.
import type { PipelineStatus } from '@eda/contracts/enums';
import { cn, Icon, type IconName, PIPELINE_STATUS_VIEW, TONE_CLASSES, useAnnounce } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState } from 'react';
import {
  isActiveRow,
  isKunyeDetail,
  type PipelineRow,
  type PipelineState,
  type PipelineView,
  pipelineView,
  rowElapsedMs,
} from './pipeline-store.ts';

const SECONDS = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

/** "2,4" (10 sn altı tek ondalık) veya "37". */
export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return SECONDS.format(s < 10 ? Math.round(s * 10) / 10 : Math.round(s));
}

function useNow(ticking: boolean, intervalMs = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) {
      setNow(Date.now());
      return;
    }
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [ticking, intervalMs]);
  return now;
}

/** Dönen simge + azaltılmış harekette statik karşılığı (StatusIcon kalıbı; görünürlük CSS ile). */
function StatusGlyph({
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

function RowIcon({ status }: { status: PipelineStatus }) {
  const view = PIPELINE_STATUS_VIEW[status];
  return (
    <StatusGlyph
      icon={view.icon}
      staticIcon={'staticIcon' in view ? view.staticIcon : undefined}
      className={TONE_CLASSES[view.tone].icon}
    />
  );
}

function Row({ row, now }: { row: PipelineRow; now: number }) {
  const t = useTranslations('chat.pipeline');
  return (
    <li className="flex items-start gap-2.5 py-1">
      <span className="mt-0.5 flex">
        <RowIcon status={row.status} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={row.status === 'error' ? 'text-danger' : 'text-fg'}>
          {row.label}
          {row.status === 'error' && <span className="sr-only">{` (${t('rowFailed')})`}</span>}
        </span>
        {row.detail &&
          (isKunyeDetail(row) ? (
            <span className="inline-flex max-w-full self-start rounded-sm border border-border bg-surface-sunken px-1.5 py-0.5 text-caption text-fg-muted">
              <span className="truncate">{row.detail}</span>
            </span>
          ) : (
            <span className="text-caption text-fg-subtle">{row.detail}</span>
          ))}
      </div>
      {/* Anlık aşamalar (ör. maskeleme) için "0 sn" yazılmaz. */}
      {(isActiveRow(row) || rowElapsedMs(row, now) >= 50) && (
        <span
          className="shrink-0 pt-0.5 text-caption text-fg-subtle tabular-nums"
          aria-hidden="true"
        >
          {t('seconds', { value: formatSeconds(rowElapsedMs(row, now)) })}
        </span>
      )}
    </li>
  );
}

export function PipelineBar({ state }: { state: PipelineState }) {
  const t = useTranslations('chat.pipeline');
  const announce = useAnnounce();
  const listId = useId();
  const settled = state.endedAt !== null;
  const now = useNow(!settled);
  const view = pipelineView(state, now);
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? !settled;

  const activeLabels = view.active.map((r) => r.label);
  const headline = settled
    ? summaryText(t, view)
    : activeLabels.length === 0
      ? t('preparing')
      : activeLabels.length === 1
        ? (activeLabels[0] ?? '')
        : null;

  // Aşama değişiminde tek polite duyuru (progress tikleri duyurulmaz; 055 §4.2).
  const lastAnnounced = useRef<string>('');
  const announceText = settled ? '' : activeLabels.join(', ') || t('preparing');
  useEffect(() => {
    if (announceText === '' || announceText === lastAnnounced.current) return;
    lastAnnounced.current = announceText;
    announce(announceText, { key: 'pipeline' });
  }, [announceText, announce]);

  // Kapanış simgesi: yalnız hata -> tehlike; durdurma -> nötr; aksi tamam.
  const closing: { icon: IconName; className: string } =
    view.failed > 0 && view.toolCounts.length === 0
      ? { icon: 'tone.danger', className: 'text-danger' }
      : view.skipped > 0
        ? { icon: 'message.stopped', className: 'text-fg-muted' }
        : { icon: 'tone.success', className: 'text-success' };
  return (
    <section
      aria-label={t('label')}
      data-settled={settled || undefined}
      className="rounded-lg border border-border bg-surface text-body-sm shadow-1"
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setUserOpen(!open)}
        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors duration-fast hover:bg-surface-sunken focus-visible:focus-ring"
      >
        {settled ? (
          <Icon icon={closing.icon} size="sm" className={cn('shrink-0', closing.className)} />
        ) : (
          <StatusGlyph
            icon="status.loading"
            staticIcon="status.loading-static"
            className="text-info"
          />
        )}
        <span className="min-w-0 flex-1 truncate text-fg">
          {headline ?? (
            <>
              <span className="font-medium">{t('parallel', { count: activeLabels.length })}</span>
              <span className="text-fg-muted">{` · ${activeLabels.join(', ')}`}</span>
            </>
          )}
        </span>
        <span className="shrink-0 text-caption text-fg-subtle tabular-nums">
          {t('meta', { steps: view.steps, seconds: formatSeconds(view.elapsedMs) })}
        </span>
        <Icon
          icon={open ? 'control.chevron-up' : 'control.chevron-down'}
          size="sm"
          className="shrink-0 text-fg-subtle"
        />
      </button>
      <div id={listId} hidden={!open}>
        {state.rows.length > 0 ? (
          <ol className="flex flex-col border-t border-border px-3 py-1.5">
            {state.rows.map((row) => (
              <Row key={row.key} row={row} now={now} />
            ))}
          </ol>
        ) : (
          <p className="border-t border-border px-3 py-2 text-fg-muted">{t('preparing')}</p>
        )}
      </div>
    </section>
  );
}

type Translate = ReturnType<typeof useTranslations<'chat.pipeline'>>;

function summaryText(
  t: Translate,
  {
    toolCounts,
    steps,
    failed,
    skipped,
  }: Pick<PipelineView, 'toolCounts' | 'steps' | 'failed' | 'skipped'>,
): string {
  const parts = toolCounts.map(({ toolName, count }) => {
    const key = `tools.${toolName}`;
    return t.has(key as Parameters<Translate['has']>[0])
      ? t(key as Parameters<Translate>[0], { count })
      : t('tools.other', { count });
  });
  if (failed > 0) parts.push(t('failedCount', { count: failed }));
  if (skipped > 0) parts.push(t('skippedCount', { count: skipped }));
  return parts.length > 0 ? parts.join(', ') : t('stepsDone', { count: steps });
}

/** Sayfa yenilenince geçici olaylar yoktur: özet yalnız kaynak sayısından türetilir. */
export function PipelineSummaryStatic({ sourceCount }: { sourceCount: number }) {
  const t = useTranslations('chat.pipeline');
  if (sourceCount === 0) return null;
  return (
    <p className="flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2 text-body-sm text-fg shadow-1">
      <Icon icon="tone.success" size="sm" className="shrink-0 text-success" />
      {t('sourcesFetched', { count: sourceCount })}
    </p>
  );
}
