'use client';
// İstatistikler: toplulaştırılmış, içeriksiz platform sayaçları. Kullanıcı veya dava bazlı veri YOKTUR
// (R8 W-22). Her grafik "Tablo olarak göster" ile erişilebilir tablo taşır; renk tek başına anlam
// taşımaz (değerler sayı olarak da verilir).
import type { AdminStatsResponseValue } from '@eda/contracts/api/admin';
import {
  Button,
  Card,
  ErrorState,
  PageContainer,
  PageHeader,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarSeries } from '../../components/charts.tsx';
import { adminFetch } from '../../lib/admin-api.ts';

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

type MetricKey =
  | 'signups'
  | 'applications'
  | 'approvals'
  | 'activeUsers'
  | 'chatTurns'
  | 'documents'
  | 'llmCalls'
  | 'llmErrors';

const METRICS: readonly MetricKey[] = [
  'signups',
  'applications',
  'approvals',
  'activeUsers',
  'chatTurns',
  'documents',
  'llmCalls',
  'llmErrors',
];

export function StatsView() {
  const t = useTranslations('stats');
  const format = useFormatter();
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<AdminStatsResponseValue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tableFor, setTableFor] = useState<MetricKey | null>(null);

  const load = useCallback(async (r: Range) => {
    setState('loading');
    const to = new Date();
    const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (r - 1));
    try {
      setData(
        await adminFetch<AdminStatsResponseValue>(`/stats?from=${isoDay(from)}&to=${isoDay(to)}`),
      );
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load(range);
  }, [load, range]);

  const totals = useMemo(() => {
    const out = {} as Record<MetricKey, number>;
    for (const m of METRICS) out[m] = (data?.daily ?? []).reduce((n, d) => n + d[m], 0);
    return out;
  }, [data]);

  const usd = (micro: number) =>
    format.number(micro / 1_000_000, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    });
  const num = (v: number) => format.number(v);

  return (
    <PageContainer>
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          <fieldset className="flex gap-1 border-0 p-0">
            <legend className="sr-only">{t('range')}</legend>
            {RANGES.map((r) => (
              <Button
                key={r}
                size="sm"
                variant={range === r ? 'primary' : 'outline'}
                aria-pressed={range === r}
                onClick={() => setRange(r)}
              >
                {t('days', { count: r })}
              </Button>
            ))}
          </fieldset>
        }
      />
      {state === 'error' && (
        <ErrorState
          title={t('error')}
          onRetry={() => void load(range)}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      )}
      {state === 'loading' && (
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2">
          <span className="sr-only">{t('loading')}</span>
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      )}
      {state === 'ready' && data && (
        <>
          <section aria-labelledby="huni" className="flex flex-col gap-3">
            <h2 id="huni" className="text-title text-fg">
              {t('funnel')}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ['signups', data.funnel.signups],
                  ['emailVerified', data.funnel.emailVerified],
                  ['applications', data.funnel.applications],
                  ['approved', data.funnel.approved],
                ] as const
              ).map(([k, v]) => (
                <Card key={k} className="flex flex-col gap-1 p-5">
                  <p className="text-caption text-fg-subtle">{t(`funnelStep.${k}`)}</p>
                  <p className="font-display text-heading-lg text-fg tabular-nums">{num(v)}</p>
                  {data.funnel.signups > 0 && k !== 'signups' && (
                    <p className="text-caption text-fg-muted">
                      {t('ofSignups', {
                        pct: format.number(v / data.funnel.signups, {
                          style: 'percent',
                          maximumFractionDigits: 0,
                        }),
                      })}
                    </p>
                  )}
                </Card>
              ))}
            </div>
            <p className="text-body-sm text-fg-muted">
              {t('funnelFoot', {
                rejected: data.funnel.rejected,
                pending: data.funnel.pending,
                hours:
                  data.funnel.medianDecisionHours === null
                    ? '—'
                    : format.number(data.funnel.medianDecisionHours),
              })}
            </p>
          </section>

          <section aria-labelledby="seri" className="flex flex-col gap-3">
            <h2 id="seri" className="text-title text-fg">
              {t('series')}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {METRICS.map((m) => (
                <Card key={m} className="flex flex-col gap-2 p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-body-sm font-medium text-fg">{t(`metric.${m}`)}</h3>
                    <p className="font-display text-title text-fg tabular-nums">{num(totals[m])}</p>
                  </div>
                  <BarSeries
                    values={data.daily.map((d) => d[m])}
                    className={m === 'llmErrors' ? 'text-danger' : 'text-primary'}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={tableFor === m}
                    onClick={() => setTableFor(tableFor === m ? null : m)}
                  >
                    {tableFor === m ? t('hideTable') : t('showTable')}
                  </Button>
                  {tableFor === m && (
                    <Table caption={t(`metric.${m}`)}>
                      <thead>
                        <tr>
                          <Th>{t('day')}</Th>
                          <Th>{t('value')}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.daily.map((d) => (
                          <Tr key={d.day}>
                            <Td className="tabular-nums">{d.day}</Td>
                            <Td className="tabular-nums">{num(d[m])}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card>
              ))}
            </div>
            <Card className="flex items-baseline justify-between gap-2 p-5">
              <h3 className="text-body-sm font-medium text-fg">{t('llmCost')}</h3>
              <p className="font-display text-title text-fg tabular-nums">
                {usd(data.daily.reduce((n, d) => n + d.llmCostMicroUsd, 0))}
              </p>
            </Card>
          </section>

          <section aria-labelledby="kirilim" className="flex flex-col gap-3">
            <h2 id="kirilim" className="text-title text-fg">
              {t('breakdown')}
            </h2>
            {data.breakdown.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t('noBreakdown')}</p>
            ) : (
              <Table caption={t('breakdown')}>
                <thead>
                  <tr>
                    <Th>{t('dimension')}</Th>
                    <Th>{t('key')}</Th>
                    <Th>{t('calls')}</Th>
                    <Th>{t('errors')}</Th>
                    <Th>{t('cost')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.breakdown.map((b) => (
                    <Tr key={`${b.dimension}:${b.key}`}>
                      <Td>{t(`dim.${b.dimension}`)}</Td>
                      <Td>{b.key}</Td>
                      <Td className="tabular-nums">{num(b.calls)}</Td>
                      <Td className="tabular-nums">{num(b.errors)}</Td>
                      <Td className="tabular-nums">
                        {b.costMicroUsd > 0 ? usd(b.costMicroUsd) : '—'}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
          <p className="text-caption text-fg-subtle">{t('privacy')}</p>
        </>
      )}
    </PageContainer>
  );
}
