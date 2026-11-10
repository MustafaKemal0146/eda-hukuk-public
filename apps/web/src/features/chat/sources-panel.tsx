'use client';
// SourcesPanel (052 §6.3; 053-02 §2.5): seçili (varsayılan son) asistan mesajının kaynakları. >= xl
// sağda satır içi `complementary` bölge, daha dar ekranda `Sheet` çekmece (çağıran seçer). Künye kayıttan
// gelir; "Resmî portalda aç" yalnız izinli resmî alan adında bağlantıdır. Çipten gelen odak öğeye taşınır.
import type { KunyeStatus } from '@eda/contracts/enums';
import { scopeItemOf } from '@eda/contracts/scope';
import type { SourceItem } from '@eda/contracts/stream';
import { Button, EmptyState, Icon, IconButton, SourceChip } from '@eda/ui';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef } from 'react';
import { safeHref } from '../../lib/safe-link.ts';
import { InstitutionMark } from '../scope/institution-mark.tsx';
import { findPassage, splitByRanges } from './highlight.ts';
import { useSourceMeta } from './source-meta.ts';
import { previewIdOf, SourcePreview } from './source-preview.tsx';
import { type CitationReason, useChipLabel } from './use-chip-label.ts';

export type SourcesPanelData = {
  sources: readonly SourceItem[];
  statuses: ReadonlyMap<string, KunyeStatus>;
  /** Durum nedeni (ör. `quote_mismatch`); verilmezse etiket yalnız durumdan gelir. */
  reasons?: ReadonlyMap<string, CitationReason>;
  activeRef: string | null;
  /** Etkin çipin bulunduğu yanıt cümlesi (etiketsiz); "atıftan pasaja" vurgusunun girdisi (#58). */
  activeClaim: string;
  /** Her kaynak için yanıtta o kaynağa atıf yapan cümleler; çipe tıklanmasa da vurgu bundan gelir. */
  claims: ReadonlyMap<string, string>;
  /** Önizleme açıksa önizlenen kaynak ve canlı karar kimliği (#58); kapalıysa null. */
  preview: { source: SourceItem; decisionId: string } | null;
  onPreview: (ref: string | null) => void;
  /** Odak isteği sayacı: aynı çipe yeniden tıklanınca da odak taşınsın. */
  focusTick: number;
};

/**
 * Modelin okuduğu metin; yanıtın atıf yaptığı pasaj her zaman vurgulanır, etkin çipte ayrıca
 * görünüme ortalanır.
 */
function ExcerptView({
  excerpt,
  claim,
  active,
}: {
  excerpt: string;
  claim: string;
  active: boolean;
}) {
  const t = useTranslations('chat.sources');
  const markRef = useRef<HTMLElement>(null);
  const passage = useMemo(() => findPassage(claim, excerpt), [claim, excerpt]);
  useEffect(() => {
    if (active && passage) markRef.current?.scrollIntoView({ block: 'center' });
  }, [active, passage]);
  const parts = splitByRanges(excerpt, passage?.ranges ?? []);
  let firstMark = true;
  return (
    <div className="flex flex-col gap-1.5">
      {claim !== '' && (
        <p className="text-caption text-fg-subtle">
          {passage && passage.ranges.length > 0
            ? t(passage.kind === 'quote' ? 'passage.quote' : 'passage.overlap')
            : t('passage.none')}
        </p>
      )}
      {passage && passage.unmatchedQuotes.length > 0 && (
        <p
          role="alert"
          className="rounded-sm bg-warning-soft px-2 py-1 text-caption text-warning-on-soft"
        >
          {t('passage.notVerbatim')}
        </p>
      )}
      <blockquote className="max-h-64 overflow-y-auto whitespace-pre-line rounded-sm border border-border bg-surface-sunken p-2 text-body-sm text-fg-muted">
        {parts.map((p, i) => {
          if (!p.mark) return <span key={`${i}-t`}>{p.text}</span>;
          const attach = firstMark;
          firstMark = false;
          return (
            <mark
              key={`${i}-m`}
              {...(attach ? { ref: markRef } : {})}
              className="rounded-sm bg-warning-soft box-decoration-clone text-fg"
            >
              {p.text}
            </mark>
          );
        })}
      </blockquote>
    </div>
  );
}

function SourceListItem({
  source,
  status,
  reason,
  active,
  claim,
  focusTick,
  onPreview,
}: {
  onPreview: ((ref: string) => void) | null;
  source: SourceItem;
  status: KunyeStatus | undefined;
  reason?: CitationReason | undefined;
  active: boolean;
  claim: string;
  focusTick: number;
}) {
  const t = useTranslations('chat.sources');
  const chipLabel = useChipLabel();
  const sourceMeta = useSourceMeta();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!active || focusTick === 0) return;
    const el = ref.current;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    el.focus({ preventScroll: true });
  }, [active, focusTick]);

  const href = safeHref(source.url);
  const mark = scopeItemOf(source);
  // Portal adı ve erişim tarihi `[K#]` çipiyle aynı veriden (fetchedAt, yoksa retrievedAt) türer.
  const meta = sourceMeta(source);
  const relevance = t(`relevance.${source.relevance}`);
  return (
    <li
      ref={ref}
      tabIndex={-1}
      data-ref={source.ref}
      aria-current={active ? 'true' : undefined}
      className={
        active
          ? 'flex flex-col gap-2 rounded-md border border-border-strong bg-primary-soft p-3 shadow-1 focus-visible:focus-ring'
          : 'flex flex-col gap-2 rounded-md border border-border bg-surface p-3 focus-visible:focus-ring'
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        {mark && <InstitutionMark id={mark} size="md" />}
        <SourceChip
          shortKunye={source.shortKunye}
          {...(status ? { status } : {})}
          label={chipLabel(source.shortKunye, status, source, reason)}
        />
      </div>
      {source.title && <p className="text-body-sm text-fg">{source.title}</p>}
      <p className="text-caption text-fg-subtle" data-testid="source-meta">
        {meta.date
          ? t('meta', { portal: meta.portal, date: meta.date, relevance })
          : t('metaNoDate', { portal: meta.portal, relevance })}
      </p>
      <p className="text-caption font-medium text-fg-muted">
        {source.excerpt ? t('read.text') : t('read.kunye')}
      </p>
      {source.excerpt ? (
        <ExcerptView excerpt={source.excerpt} claim={claim} active={active} />
      ) : null}
      {onPreview ? (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => onPreview(source.ref)}
        >
          {t('preview.open')}
        </Button>
      ) : null}
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="inline-flex items-center gap-1.5 self-start rounded-sm text-body-sm text-primary underline-offset-2 hover:underline focus-visible:focus-ring"
        >
          {t('openOfficial')}
          <Icon icon="action.external" size="sm" />
          <span className="sr-only">{t('opensNewTab')}</span>
        </a>
      ) : null}
    </li>
  );
}

function PreviewOf({
  data,
}: {
  data: SourcesPanelData & { preview: NonNullable<SourcesPanelData['preview']> };
}) {
  return (
    <SourcePreview
      source={data.preview.source}
      decisionId={data.preview.decisionId}
      claim={data.activeClaim || (data.claims.get(data.preview.source.ref) ?? '')}
      onClose={() => data.onPreview(null)}
    />
  );
}

export function SourcesList({ data }: { data: SourcesPanelData }) {
  const t = useTranslations('chat.sources');
  if (data.preview) return <PreviewOf data={{ ...data, preview: data.preview }} />;
  if (data.sources.length === 0) {
    return (
      <EmptyState
        as="h3"
        icon="nav.decisions"
        title={t('emptyTitle')}
        description={t('emptyBody')}
        className="py-10"
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {data.sources.map((s) => (
        <SourceListItem
          key={s.ref}
          source={s}
          // Atıf yapılmamış kaynak da resmî portaldan canlı getirildi: künyesi kaynakta mevcuttur.
          status={data.statuses.get(s.ref) ?? (s.origin === 'live' ? 'verified' : undefined)}
          reason={data.reasons?.get(s.ref)}
          active={data.activeRef === s.ref}
          claim={data.activeRef === s.ref ? data.activeClaim : (data.claims.get(s.ref) ?? '')}
          onPreview={previewIdOf(s) ? data.onPreview : null}
          focusTick={data.focusTick}
        />
      ))}
    </ul>
  );
}

/** Satır içi panel (>= xl). Sheet modunda yalnız `SourcesList` kullanılır (başlık Sheet'tedir). */
export function SourcesPanel({ data, onClose }: { data: SourcesPanelData; onClose?: () => void }) {
  const t = useTranslations('chat.sources');
  if (data.preview) {
    return (
      <aside aria-label={t('preview.title')} className="flex h-full min-h-0 flex-col">
        <PreviewOf data={{ ...data, preview: data.preview }} />
      </aside>
    );
  }
  return (
    <aside aria-labelledby="kaynaklar-baslik" className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 id="kaynaklar-baslik" className="text-title text-fg">
            {t('title')}
          </h2>
          <p className="text-caption text-fg-subtle">
            {t('count', { count: data.sources.length })}
          </p>
        </div>
        {onClose && <IconButton icon="action.close" label={t('close')} onClick={onClose} />}
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto p-3">
        <SourcesList data={data} />
      </div>
    </aside>
  );
}
