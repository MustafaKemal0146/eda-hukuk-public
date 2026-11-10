'use client';
// Sohbetler ve raporlar: toplulaştırılmış, içeriksiz sohbet kullanım raporu. Sohbet/mesaj metni, kullanıcı
// ve büro bazlı satır YOKTUR; indirme (CSV) YOKTUR. Her grafik "Tablo olarak göster" ile erişilebilir tablo
// taşır; renk tek başına anlam taşımaz (değerler sayı olarak da verilir).
import type { ChatReportsResponseValue } from '@eda/contracts/api/admin-chat-reports';
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
import {
  CHAT_REPORT_RANGES,
  type ChatReportRange,
  DAILY_METRICS,
  type DailyMetric,
  rangeQuery,
  share,
  sumDaily,
  toolErrorTotals,
  weightedAvgTurnSeconds,
} from './model.ts';

/** Dağılım çubuğu: genişlik payı, değer sayı olarak da yazılır. */
function ShareBar({ label, value, total }: { label: string; value: number; total: number }) {
  const format = useFormatter();
  const ratio = share(value, total) ?? 0;
  return (
    <li className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2 text-body-sm">
        <span className="text-fg">{label}</span>
        <span className="tabular-nums text-fg-muted">
          {format.number(value)} ·{' '}
          {format.number(ratio, { style: 'percent', maximumFractionDigits: 0 })}
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden="true">
        <svg
          className="h-full w-full"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <rect width={`${Math.round(ratio * 100)}%`} height="100%" className="fill-primary" />
        </svg>
      </div>
    </li>
  );
}

export function ChatReportsView() {
  const t = useTranslations('chatReports');
  const format = useFormatter();
  const [range, setRange] = useState<ChatReportRange>(30);
  const [data, setData] = useState<ChatReportsResponseValue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tableFor, setTableFor] = useState<DailyMetric | null>(null);

  const load = useCallback(async (r: ChatReportRange) => {
    setState('loading');
    try {
      setData(await adminFetch<ChatReportsResponseValue>(`/chat-reports?${rangeQuery(r)}`));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load(range);
  }, [load, range]);

  const num = (v: number) => format.number(v);
  const pct = (v: number | null) =>
    v === null ? '—' : format.number(v, { style: 'percent', maximumFractionDigits: 1 });

  const kpi = useMemo(() => {
    if (!data) return null;
    const tools = toolErrorTotals(data.tools);
    const avg = weightedAvgTurnSeconds(data.daily);
    const turns = sumDaily(data.daily, 'turns');
    return {
      conversations: sumDaily(data.daily, 'conversations'),
      messages: sumDaily(data.daily, 'messages'),
      turns,
      avgTurn:
        avg === null
          ? '—'
          : t('seconds', { value: format.number(avg, { maximumFractionDigits: 1 }) }),
      turnErrorRate: pct(share(sumDaily(data.daily, 'turnErrors'), turns)),
      toolCalls: tools.calls,
      toolErrorRate: pct(share(tools.errors, tools.calls)),
      sources: data.sources.reduce((n, s) => n + s.count, 0),
    };
  }, [data]);

  const modeTotal = data?.modes.reduce((n, m) => n + m.calls, 0) ?? 0;
  const aliasTotal = data?.aliases.reduce((n, a) => n + a.turns, 0) ?? 0;
  const sourceTotal = data?.sources.reduce((n, s) => n + s.count, 0) ?? 0;
  const originTotal = data?.sourceOrigins.reduce((n, s) => n + s.count, 0) ?? 0;
  const orgTotal = data?.orgKinds.reduce((n, s) => n + s.conversations, 0) ?? 0;
  const fbDownTotal = data?.feedback.downCategories.reduce((n, c) => n + c.count, 0) ?? 0;

  return (
    <PageContainer>
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          <fieldset className="flex gap-1 border-0 p-0">
            <legend className="sr-only">{t('range')}</legend>
            {CHAT_REPORT_RANGES.map((r) => (
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
      {state === 'ready' && data && kpi && (
        <>
          <section aria-labelledby="ozet" className="flex flex-col gap-3">
            <h2 id="ozet" className="text-title text-fg">
              {t('summary')}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  ['conversations', num(kpi.conversations)],
                  ['messages', num(kpi.messages)],
                  ['turns', num(kpi.turns)],
                  ['avgTurn', kpi.avgTurn],
                  ['turnErrorRate', kpi.turnErrorRate],
                  ['toolCalls', num(kpi.toolCalls)],
                  ['toolErrorRate', kpi.toolErrorRate],
                  ['sources', num(kpi.sources)],
                ] as const
              ).map(([k, v]) => (
                <Card key={k} className="flex flex-col gap-1 p-5">
                  <p className="text-caption text-fg-subtle">{t(`kpi.${k}`)}</p>
                  <p className="font-display text-heading-lg text-fg tabular-nums">{v}</p>
                </Card>
              ))}
            </div>
          </section>

          <section aria-labelledby="seri" className="flex flex-col gap-3">
            <h2 id="seri" className="text-title text-fg">
              {t('series')}
            </h2>
            <div className="grid gap-4 md:grid-cols-2">
              {DAILY_METRICS.map((m) => (
                <Card key={m} className="flex flex-col gap-2 p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-body-sm font-medium text-fg">{t(`metric.${m}`)}</h3>
                    <p className="font-display text-title text-fg tabular-nums">
                      {m === 'activeOrgs'
                        ? num(Math.max(0, ...data.daily.map((d) => d.activeOrgs)))
                        : num(sumDaily(data.daily, m))}
                    </p>
                  </div>
                  <BarSeries
                    values={data.daily.map((d) => d[m])}
                    className={
                      m === 'turnErrors' || m === 'feedbackDown' ? 'text-danger' : 'text-primary'
                    }
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
          </section>

          <section aria-labelledby="dagilim" className="grid gap-4 md:grid-cols-2">
            <Card className="flex flex-col gap-3 p-5">
              <h2 id="dagilim" className="text-title text-fg">
                {t('modeSection')}
              </h2>
              {data.modes.length === 0 ? (
                <p className="text-body-sm text-fg-muted">{t('none')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.modes.map((m) => (
                    <ShareBar
                      key={m.mode}
                      label={t(`mode.${m.mode}`)}
                      value={m.calls}
                      total={modeTotal}
                    />
                  ))}
                </ul>
              )}
            </Card>
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-title text-fg">{t('aliasSection')}</h2>
              {data.aliases.length === 0 ? (
                <p className="text-body-sm text-fg-muted">{t('none')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.aliases.map((a) => (
                    <ShareBar
                      key={a.alias}
                      label={t(`alias.${a.alias}`)}
                      value={a.turns}
                      total={aliasTotal}
                    />
                  ))}
                </ul>
              )}
            </Card>
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-title text-fg">{t('sourceSection')}</h2>
              {data.sources.length === 0 ? (
                <p className="text-body-sm text-fg-muted">{t('none')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.sources.map((s) => (
                    <ShareBar
                      key={s.kind}
                      label={t(`sourceKind.${s.kind}`)}
                      value={s.count}
                      total={sourceTotal}
                    />
                  ))}
                  {data.sourceOrigins.map((s) => (
                    <ShareBar
                      key={s.origin}
                      label={t(`sourceOrigin.${s.origin}`)}
                      value={s.count}
                      total={originTotal}
                    />
                  ))}
                </ul>
              )}
            </Card>
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-title text-fg">{t('orgKindSection')}</h2>
              {data.orgKinds.length === 0 ? (
                <p className="text-body-sm text-fg-muted">{t('none')}</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {data.orgKinds.map((o) => (
                    <ShareBar
                      key={o.kind}
                      label={t(`orgKind.${o.kind}`)}
                      value={o.conversations}
                      total={orgTotal}
                    />
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section aria-labelledby="arac" className="flex flex-col gap-3">
            <h2 id="arac" className="text-title text-fg">
              {t('toolSection')}
            </h2>
            {data.tools.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t('none')}</p>
            ) : (
              <Table caption={t('toolSection')}>
                <thead>
                  <tr>
                    <Th>{t('toolSection')}</Th>
                    <Th>{t('colCalls')}</Th>
                    <Th>{t('colErrors')}</Th>
                    <Th>{t('colErrorRate')}</Th>
                    <Th>{t('colAvgMs')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.tools.map((x) => (
                    <Tr key={x.tool}>
                      <Td>{t(`tool.${x.tool}`)}</Td>
                      <Td className="tabular-nums">{num(x.calls)}</Td>
                      <Td className="tabular-nums">{num(x.errors)}</Td>
                      <Td className="tabular-nums">{pct(x.errorRate)}</Td>
                      <Td className="tabular-nums">{num(x.avgDurationMs)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>

          <section aria-labelledby="rapor" className="flex flex-col gap-3">
            <h2 id="rapor" className="text-title text-fg">
              {t('reports')}
            </h2>
            <p className="text-body-sm text-fg-muted">{t('feedbackIntro')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Card className="flex flex-col gap-1 p-5">
                <p className="text-caption text-fg-subtle">{t('feedbackUp')}</p>
                <p className="font-display text-heading-lg text-fg tabular-nums">
                  {num(data.feedback.up)}
                </p>
              </Card>
              <Card className="flex flex-col gap-1 p-5">
                <p className="text-caption text-fg-subtle">{t('feedbackDown')}</p>
                <p className="font-display text-heading-lg text-fg tabular-nums">
                  {num(data.feedback.down)}
                </p>
              </Card>
            </div>
            {data.feedback.downCategories.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t('none')}</p>
            ) : (
              <Card className="p-5">
                <ul className="flex flex-col gap-3">
                  {data.feedback.downCategories.map((c) => (
                    <ShareBar
                      key={c.category}
                      label={t(`feedbackCategory.${c.category}`)}
                      value={c.count}
                      total={fbDownTotal}
                    />
                  ))}
                </ul>
              </Card>
            )}
            <p className="text-body-sm text-fg-muted">{t('noReportTable')}</p>
            {data.unavailable.map((u) => (
              <p key={u} className="text-body-sm text-fg-muted">
                {t(`unavailable.${u}`)}
              </p>
            ))}
          </section>
          <p className="text-caption text-fg-subtle">{t('privacy')}</p>
        </>
      )}
    </PageContainer>
  );
}
