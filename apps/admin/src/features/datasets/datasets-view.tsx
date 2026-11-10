'use client';
// Veri seti: karar arşivi ve mevzuat kaynak durumu (yalnız izleme). Kaynak başına kayıt sayısı, son
// başarı/hata, hata KODU, mevzuat özeti ve son alım çalıştırmaları. Yükleme/silme ve metin yoktur.
import type {
  AdminDatasetsDtoValue,
  DatasetRunDtoValue,
  DatasetSourceDtoValue,
} from '@eda/contracts/api/admin-datasets';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageContainer,
  PageHeader,
  SectionHeader,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/admin-api.ts';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: AdminDatasetsDtoValue }
  | { kind: 'error' };

const STATE_TONE = {
  up: 'success',
  degraded: 'warning',
  down: 'danger',
  disabled: 'neutral',
} as const;

const RUN_TONE = {
  running: 'info',
  succeeded: 'success',
  partial: 'warning',
  failed: 'danger',
} as const satisfies Record<DatasetRunDtoValue['status'], string>;

export function DatasetsView() {
  const t = useTranslations('datasets');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', data: await adminFetch<AdminDatasetsDtoValue>('/datasets') });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const n = (v: number) => format.number(v);
  const when = (iso: string | null) =>
    iso === null
      ? t('never')
      : format.dateTime(new Date(iso), {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  const day = (v: string | null) =>
    v === null
      ? '—'
      : format.dateTime(new Date(`${v}T00:00:00`), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });

  if (state.kind === 'error') {
    return (
      <PageContainer width="content">
        <ErrorState
          title={t('error')}
          onRetry={() => void load()}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      </PageContainer>
    );
  }
  if (state.kind === 'loading') {
    return (
      <PageContainer width="content">
        <PageHeader title={t('title')} />
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </PageContainer>
    );
  }

  const d = state.data;
  const sourceState = (s: DatasetSourceDtoValue) =>
    s.state === null ? t('state.unknown') : t(`state.${s.state}`);

  return (
    <PageContainer width="content">
      <PageHeader title={t('title')} description={t('intro')} />
      <section className="flex flex-col gap-3">
        <SectionHeader title={t('sourcesTitle')} />
        {d.sources.length === 0 ? (
          <EmptyState icon="nav.decisions" title={t('emptySources')} />
        ) : (
          <Table caption={t('sourcesCaption')}>
            <thead>
              <tr>
                <Th>{t('col.source')}</Th>
                <Th>{t('col.state')}</Th>
                <Th>{t('col.breaker')}</Th>
                <Th className="text-right">{t('col.records')}</Th>
                <Th className="text-right">{t('col.corpus')}</Th>
                <Th className="text-right">{t('col.live')}</Th>
                <Th className="text-right">{t('col.withdrawn')}</Th>
                <Th>{t('col.retrieved')}</Th>
                <Th>{t('col.lastSuccess')}</Th>
                <Th>{t('col.lastError')}</Th>
                <Th>{t('col.canary')}</Th>
              </tr>
            </thead>
            <tbody>
              {d.sources.map((s) => (
                <Tr key={s.source}>
                  <Td className="font-mono text-caption">{s.source}</Td>
                  <Td>
                    <Badge tone={s.state === null ? 'neutral' : STATE_TONE[s.state]}>
                      {sourceState(s)}
                    </Badge>
                  </Td>
                  <Td>{s.breakerState === null ? '—' : t(`breaker.${s.breakerState}`)}</Td>
                  <Td className="text-right tabular-nums">{n(s.decisionCount)}</Td>
                  <Td className="text-right tabular-nums">{n(s.corpusCount)}</Td>
                  <Td className="text-right tabular-nums">{n(s.liveCount)}</Td>
                  <Td className="text-right tabular-nums">{n(s.withdrawnCount)}</Td>
                  <Td className="tabular-nums">{when(s.lastRetrievedAt)}</Td>
                  <Td className="tabular-nums">{when(s.lastSuccessAt)}</Td>
                  <Td>
                    {s.hasError ? (
                      <div className="flex flex-col gap-0.5">
                        <Badge tone="danger">{t('errorFlag')}</Badge>
                        <span className="tabular-nums">{when(s.lastErrorAt)}</span>
                        {s.lastErrorCode && (
                          <span className="font-mono text-caption">{s.lastErrorCode}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-fg-subtle">{t('noError')}</span>
                    )}
                  </Td>
                  <Td>
                    {s.lastCanaryOk === null
                      ? t('canary.none')
                      : s.lastCanaryOk
                        ? t('canary.ok')
                        : t('canary.failed')}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeader title={t('legislationTitle')} />
        {d.legislation.length === 0 ? (
          <EmptyState icon="nav.legislation" title={t('emptyLaws')} />
        ) : (
          <Table caption={t('legislationCaption')}>
            <thead>
              <tr>
                <Th>{t('col.lawType')}</Th>
                <Th className="text-right">{t('col.laws')}</Th>
                <Th className="text-right">{t('col.inForce')}</Th>
                <Th className="text-right">{t('col.repealed')}</Th>
                <Th className="text-right">{t('col.articles')}</Th>
                <Th>{t('col.snapshot')}</Th>
                <Th>{t('col.amended')}</Th>
              </tr>
            </thead>
            <tbody>
              {d.legislation.map((l) => (
                <Tr key={l.lawType}>
                  <Td>
                    {t(
                      `lawType.${l.lawType as 'constitution' | 'law' | 'decree_law' | 'presidential_decree' | 'regulation'}`,
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{n(l.lawCount)}</Td>
                  <Td className="text-right tabular-nums">{n(l.inForceCount)}</Td>
                  <Td className="text-right tabular-nums">{n(l.repealedCount)}</Td>
                  <Td className="text-right tabular-nums">{n(l.articleCount)}</Td>
                  <Td className="tabular-nums">{when(l.lastSnapshotAt)}</Td>
                  <Td className="tabular-nums">{day(l.lastAmendedDate)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeader title={t('runsTitle')} />
        {d.runs.length === 0 ? (
          <EmptyState icon="file.processing" title={t('emptyRuns')} />
        ) : (
          <Table caption={t('runsCaption')}>
            <thead>
              <tr>
                <Th>{t('col.kind')}</Th>
                <Th>{t('col.source')}</Th>
                <Th>{t('col.runStatus')}</Th>
                <Th className="text-right">{t('col.seen')}</Th>
                <Th className="text-right">{t('col.inserted')}</Th>
                <Th className="text-right">{t('col.updated')}</Th>
                <Th className="text-right">{t('col.failed')}</Th>
                <Th>{t('col.started')}</Th>
                <Th>{t('col.finished')}</Th>
              </tr>
            </thead>
            <tbody>
              {d.runs.map((r) => (
                <Tr key={r.runId}>
                  <Td>
                    {t(
                      `runKind.${r.kind as 'live_hit' | 'bulk' | 'legislation_snapshot' | 'reembed' | 'decision_summary'}`,
                    )}
                  </Td>
                  <Td className="font-mono text-caption">{r.source ?? '—'}</Td>
                  <Td>
                    <Badge tone={RUN_TONE[r.status]}>{t(`runStatus.${r.status}`)}</Badge>
                  </Td>
                  <Td className="text-right tabular-nums">{n(r.itemsSeen)}</Td>
                  <Td className="text-right tabular-nums">{n(r.itemsInserted)}</Td>
                  <Td className="text-right tabular-nums">{n(r.itemsUpdated)}</Td>
                  <Td className="text-right tabular-nums">{n(r.itemsFailed)}</Td>
                  <Td className="tabular-nums">{when(r.startedAt)}</Td>
                  <Td className="tabular-nums">{when(r.finishedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      <p className="text-caption text-fg-subtle">{t('internalOnly')}</p>
      <p className="text-caption text-fg-subtle">{t('generated', { time: when(d.generatedAt) })}</p>
    </PageContainer>
  );
}
