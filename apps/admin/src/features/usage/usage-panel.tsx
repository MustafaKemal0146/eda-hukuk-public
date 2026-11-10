'use client';
// Kullanım sekmesi: toplulaştırılmış, içeriksiz sayaçlar. Kişi bazlı veri yoktur. Her grafik "Tablo olarak
// göster" ile erişilebilir tablo taşır; renk tek başına anlam taşımaz (değerler sayı olarak da verilir).
import type { AdminUsageResponseValue } from '@eda/contracts/api/admin-usage';
import {
  Badge,
  Button,
  Card,
  DateField,
  ErrorState,
  Field,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { BarSeries, HBarList, LineSeries } from '../../components/charts.tsx';
import { adminFetch } from '../../lib/admin-api.ts';
import {
  microToUsd,
  PRESET_DAYS,
  type PresetDays,
  presetRange,
  type RangeProblem,
  rangeProblem,
  share,
} from './usage-model.ts';

type MetricKey = 'tokens' | 'cost' | 'calls';
const METRICS: readonly MetricKey[] = ['tokens', 'cost', 'calls'];
type Resolution = 'day' | 'month';

export function UsagePanel({ onManageLimit }: { onManageLimit: (orgId: string) => void }) {
  const t = useTranslations('usage');
  const format = useFormatter();
  const [preset, setPreset] = useState<PresetDays | 'custom'>(30);
  const [range, setRange] = useState(() => presetRange(30, new Date()));
  const [draft, setDraft] = useState(range);
  const [problem, setProblem] = useState<RangeProblem | null>(null);
  const [org, setOrg] = useState<{ id: string; label: string } | null>(null);
  const [data, setData] = useState<AdminUsageResponseValue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tableFor, setTableFor] = useState<MetricKey | null>(null);
  const [resolution, setResolution] = useState<Resolution>('day');

  const load = useCallback(async (from: string, to: string, orgId: string | null) => {
    setState('loading');
    try {
      const q = new URLSearchParams({ from, to });
      if (orgId !== null) q.set('orgId', orgId);
      setData(await adminFetch<AdminUsageResponseValue>(`/usage?${q.toString()}`));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load(range.from, range.to, org?.id ?? null);
  }, [load, range, org]);

  const usd = (micro: number) =>
    format.number(microToUsd(micro), {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  const num = (v: number) => format.number(v);
  const pct = (v: number) => format.number(v, { style: 'percent', maximumFractionDigits: 0 });
  const kindLabel = (k: string) =>
    k === 'individual' || k === 'firm' || k === 'bar' ? t(`orgKind.${k}`) : t('orgKind.unknown');

  function pickPreset(d: PresetDays) {
    const r = presetRange(d, new Date());
    setPreset(d);
    setProblem(null);
    setDraft(r);
    setRange(r);
  }
  function applyCustom() {
    const p = rangeProblem(draft.from, draft.to);
    setProblem(p);
    if (p !== null) return;
    setPreset('custom');
    setRange(draft);
  }

  const seriesValues = (m: MetricKey): number[] => {
    if (!data) return [];
    const rows = resolution === 'day' ? data.daily : data.monthly;
    return rows.map((d) =>
      m === 'tokens' ? d.inputTokens + d.outputTokens : m === 'cost' ? d.costMicroUsd : d.calls,
    );
  };
  const metricText = (m: MetricKey, v: number) => (m === 'cost' ? usd(v) : num(v));

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <fieldset className="flex gap-1 border-0 p-0">
            <legend className="sr-only">{t('range')}</legend>
            {PRESET_DAYS.map((d) => (
              <Button
                key={d}
                size="sm"
                variant={preset === d ? 'primary' : 'outline'}
                aria-pressed={preset === d}
                onClick={() => pickPreset(d)}
              >
                {t('days', { count: d })}
              </Button>
            ))}
          </fieldset>
          <Field label={t('from')} error={problem ? t(`rangeProblem.${problem}`) : undefined}>
            <DateField
              size="sm"
              value={draft.from}
              onChange={(e) => setDraft((r) => ({ ...r, from: e.target.value }))}
            />
          </Field>
          <Field label={t('to')}>
            <DateField
              size="sm"
              value={draft.to}
              onChange={(e) => setDraft((r) => ({ ...r, to: e.target.value }))}
            />
          </Field>
          <Button
            size="sm"
            variant={preset === 'custom' ? 'primary' : 'outline'}
            onClick={applyCustom}
          >
            {t('apply')}
          </Button>
        </div>
        <p className="text-caption text-fg-subtle">{t('rangeHint')}</p>
        {org && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="info">{t('orgFilterOn', { label: org.label })}</Badge>
            <Button size="sm" variant="ghost" onClick={() => setOrg(null)}>
              {t('orgFilterClear')}
            </Button>
          </div>
        )}
      </div>

      {state === 'error' && (
        <ErrorState
          title={t('error')}
          onRetry={() => void load(range.from, range.to, org?.id ?? null)}
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
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      )}

      {state === 'ready' && data && (
        <>
          <section aria-labelledby="kartlar" className="flex flex-col gap-3">
            <h2 id="kartlar" className="sr-only">
              {t('cards.calls')}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(
                [
                  ['calls', num(data.totals.calls)],
                  ['tokens', num(data.totals.inputTokens + data.totals.outputTokens)],
                  ['cost', usd(data.totals.costMicroUsd)],
                  ['input', num(data.totals.inputTokens)],
                  ['output', num(data.totals.outputTokens)],
                  ['errors', num(data.totals.errors)],
                ] as const
              ).map(([k, v]) => (
                <Card key={k} className="flex flex-col gap-1 p-5">
                  <p className="text-caption text-fg-subtle">{t(`cards.${k}`)}</p>
                  <p className="font-display text-heading-lg text-fg tabular-nums">{v}</p>
                  {k === 'input' && data.totals.cachedInputTokens > 0 && (
                    <p className="text-caption text-fg-muted">
                      {t('cachedInput')}: {num(data.totals.cachedInputTokens)}
                    </p>
                  )}
                  {k === 'output' && data.totals.reasoningTokens > 0 && (
                    <p className="text-caption text-fg-muted">
                      {t('reasoning')}: {num(data.totals.reasoningTokens)}
                    </p>
                  )}
                </Card>
              ))}
            </div>
            <p className="text-caption text-fg-subtle">{t('tokenNote')}</p>
          </section>

          <section aria-labelledby="seri" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="seri" className="text-title text-fg">
                {t('series')}
              </h2>
              <fieldset className="flex gap-1 border-0 p-0">
                <legend className="sr-only">{t('resolution')}</legend>
                {(['day', 'month'] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={resolution === r ? 'primary' : 'outline'}
                    aria-pressed={resolution === r}
                    onClick={() => setResolution(r)}
                  >
                    {t(`res.${r}`)}
                  </Button>
                ))}
              </fieldset>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {METRICS.map((m) => {
                const values = seriesValues(m);
                const total = values.reduce((a, b) => a + b, 0);
                const labels =
                  resolution === 'day'
                    ? data.daily.map((d) => d.day)
                    : data.monthly.map((d) => d.month);
                return (
                  <Card key={m} className="flex flex-col gap-2 p-5">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="text-body-sm font-medium text-fg">{t(`metric.${m}`)}</h3>
                      <p className="font-display text-title text-fg tabular-nums">
                        {metricText(m, total)}
                      </p>
                    </div>
                    {m === 'cost' ? (
                      <LineSeries values={values} className="text-primary" />
                    ) : (
                      <BarSeries values={values} className="text-primary" />
                    )}
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
                            <Th>{resolution === 'day' ? t('day') : t('month')}</Th>
                            <Th>{t('value')}</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {labels.map((l, i) => (
                            <Tr key={l}>
                              <Td className="tabular-nums">{l}</Td>
                              <Td className="tabular-nums">{metricText(m, values[i] ?? 0)}</Td>
                            </Tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </Card>
                );
              })}
            </div>
            {data.monthly.length > 0 && (
              <Table caption={t('monthly')}>
                <thead>
                  <tr>
                    <Th>{t('month')}</Th>
                    <Th>{t('calls')}</Th>
                    <Th>{t('input')}</Th>
                    <Th>{t('output')}</Th>
                    <Th>{t('cost')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((m) => (
                    <Tr key={m.month}>
                      <Td className="tabular-nums">{m.month}</Td>
                      <Td className="tabular-nums">{num(m.calls)}</Td>
                      <Td className="tabular-nums">{num(m.inputTokens)}</Td>
                      <Td className="tabular-nums">{num(m.outputTokens)}</Td>
                      <Td className="tabular-nums">{usd(m.costMicroUsd)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section aria-labelledby="modeller" className="flex flex-col gap-3">
            <h2 id="modeller" className="text-title text-fg">
              {t('models')}
            </h2>
            {data.models.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t('modelsEmpty')}</p>
            ) : (
              <>
                <Card className="p-5">
                  <HBarList
                    rows={data.models.map((m) => ({
                      id: m.modelAlias,
                      label: m.modelAlias,
                      value: m.costMicroUsd,
                      text: `${usd(m.costMicroUsd)} · ${pct(share(m.costMicroUsd, data.totals.costMicroUsd))}`,
                    }))}
                  />
                </Card>
                <Table caption={t('models')}>
                  <thead>
                    <tr>
                      <Th>{t('model')}</Th>
                      <Th>{t('calls')}</Th>
                      <Th>{t('errors')}</Th>
                      <Th>{t('input')}</Th>
                      <Th>{t('output')}</Th>
                      <Th>{t('cost')}</Th>
                      <Th>{t('share')}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((m) => (
                      <Tr key={m.modelAlias}>
                        <Td>{m.modelAlias}</Td>
                        <Td className="tabular-nums">{num(m.calls)}</Td>
                        <Td className="tabular-nums">{num(m.errors)}</Td>
                        <Td className="tabular-nums">{num(m.inputTokens)}</Td>
                        <Td className="tabular-nums">{num(m.outputTokens)}</Td>
                        <Td className="tabular-nums">{usd(m.costMicroUsd)}</Td>
                        <Td className="tabular-nums">
                          {pct(share(m.costMicroUsd, data.totals.costMicroUsd))}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </>
            )}
          </section>

          {org === null && (
            <section aria-labelledby="burolar" className="flex flex-col gap-3">
              <h2 id="burolar" className="text-title text-fg">
                {t('topOrgs')}
              </h2>
              <p className="text-body-sm text-fg-muted">{t('topOrgsNote')}</p>
              {data.topOrgs.length === 0 ? (
                <p className="text-body-sm text-fg-muted">{t('topOrgsEmpty')}</p>
              ) : (
                <>
                  <Card className="p-5">
                    <HBarList
                      rows={data.topOrgs.map((o) => ({
                        id: o.orgId,
                        label: o.orgLabel,
                        value: o.costMicroUsd,
                        text: usd(o.costMicroUsd),
                      }))}
                    />
                  </Card>
                  <Table caption={t('topOrgs')}>
                    <thead>
                      <tr>
                        <Th>{t('org')}</Th>
                        <Th>{t('calls')}</Th>
                        <Th>{t('input')}</Th>
                        <Th>{t('output')}</Th>
                        <Th>{t('cost')}</Th>
                        <Th>
                          <span className="sr-only">{t('filterByOrg')}</span>
                        </Th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topOrgs.map((o) => (
                        <Tr key={o.orgId}>
                          <Td>
                            <span className="block text-fg">{o.orgLabel}</span>
                            <span className="block text-caption text-fg-subtle">
                              {kindLabel(o.orgKind)}
                            </span>
                          </Td>
                          <Td className="tabular-nums">{num(o.calls)}</Td>
                          <Td className="tabular-nums">{num(o.inputTokens)}</Td>
                          <Td className="tabular-nums">{num(o.outputTokens)}</Td>
                          <Td className="tabular-nums">{usd(o.costMicroUsd)}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setOrg({ id: o.orgId, label: o.orgLabel })}
                              >
                                {t('filterByOrg')}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onManageLimit(o.orgId)}
                              >
                                {t('manageLimit')}
                              </Button>
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </>
              )}
            </section>
          )}
          <p className="text-caption text-fg-subtle">{t('privacy')}</p>
        </>
      )}
    </>
  );
}
