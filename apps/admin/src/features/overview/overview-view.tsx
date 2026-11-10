'use client';
// Pano: toplulaştırılmış özet kartları ve dikkat gerektirenler. Kullanıcı bazlı veya içerik veri yok.
import type { AdminOverviewDtoValue } from '@eda/contracts/api/admin';
import { Card, ErrorState, PageContainer, PageHeader, Skeleton } from '@eda/ui';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/admin-api.ts';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: AdminOverviewDtoValue }
  | { kind: 'error' };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-caption text-fg-subtle">{label}</p>
      <p className="font-display text-heading-lg text-fg tabular-nums">{value}</p>
      {hint && <p className="text-caption text-fg-muted">{hint}</p>}
    </Card>
  );
}

export function OverviewView() {
  const t = useTranslations('overview');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', data: await adminFetch<AdminOverviewDtoValue>('/overview') });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (state.kind === 'error') {
    return (
      <PageContainer>
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
      <PageContainer>
        <PageHeader title={t('title')} />
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <span className="sr-only">{t('loading')}</span>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </PageContainer>
    );
  }
  const d = state.data;
  const n = (v: number) => format.number(v);
  const usd = (micro: number) =>
    format.number(micro / 1_000_000, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  const oldest = d.applications.oldestPendingAt;
  return (
    <PageContainer>
      <PageHeader title={t('title')} description={t('intro')} />
      {d.applications.pending > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-warning-border bg-warning-soft p-4">
          <p className="text-body-sm text-warning-on-soft">
            {t('pendingAlert', { count: d.applications.pending })}
            {oldest
              ? ` ${t('oldest', {
                  date: format.dateTime(new Date(oldest), { day: 'numeric', month: 'long' }),
                })}`
              : ''}
          </p>
          <Link
            href="/basvurular"
            className="text-body-sm font-medium text-warning-on-soft underline underline-offset-4 focus-visible:focus-ring"
          >
            {t('reviewNow')}
          </Link>
        </Card>
      )}
      <section aria-labelledby="ozet" className="flex flex-col gap-3">
        <h2 id="ozet" className="text-title text-fg">
          {t('summary')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t('verifiedUsers')}
            value={n(d.verifiedUsers)}
            hint={t('signups7d', { count: d.signups7d })}
          />
          <Stat
            label={t('orgs')}
            value={n(d.orgs.individual + d.orgs.firm)}
            hint={t('orgsHint', { individual: d.orgs.individual, firm: d.orgs.firm })}
          />
          <Stat label={t('pending')} value={n(d.applications.pending)} />
          <Stat
            label={t('subscriptions')}
            value={n(d.subscriptions.active)}
            hint={t('subsHint', { trial: d.subscriptions.trialing, late: d.subscriptions.pastDue })}
          />
        </div>
      </section>
      <section aria-labelledby="bugun" className="flex flex-col gap-3">
        <h2 id="bugun" className="text-title text-fg">
          {t('today')}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label={t('chatTurns')} value={n(d.today.chatTurns)} />
          <Stat label={t('activeUsers')} value={n(d.today.activeUsers)} />
          <Stat label={t('llmCalls')} value={n(d.today.llmCalls)} />
          <Stat label={t('llmCost')} value={usd(d.today.llmCostMicroUsd)} />
        </div>
      </section>
    </PageContainer>
  );
}
