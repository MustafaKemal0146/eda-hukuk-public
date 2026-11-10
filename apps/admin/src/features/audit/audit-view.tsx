'use client';
// Denetim günlüğü ve hata özeti (053-ekranlar/11 "Denetim"). Olaylar içeriksizdir: yalnız olay türü,
// aktör türü, kimlikler ve api'nin beyaz listeden süzdüğü güvenli kodlar gösterilir. Hata özeti ayrı
// bir tablodan değil, sistemde zaten kayıtlı sinyallerden toplulaştırılır. Okuma step-up istemez
// (izin tablosuna göre); gerekirse `useStepUp` passkey ile yeniden doğrulatır.
import type {
  AuditErrorsResponseValue,
  AuditEventDtoValue,
  AuditEventsResponseValue,
} from '@eda/contracts/api/admin-audit';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { BarSeries } from '../../components/charts.tsx';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';
import { LoginFailuresCard } from './login-failures-card.tsx';
import {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_TYPES,
  AUDIT_ERROR_SOURCES,
  type AuditFilters,
  buildEventsQuery,
  EMPTY_FILTERS,
  groupOf,
  isRangeIncomplete,
  isRangeInverted,
  metadataRows,
  SOURCE_FIELD,
} from './model.ts';

type Tab = 'events' | 'errors';
const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function AuditView() {
  const t = useTranslations('audit');
  const [tab, setTab] = useState<Tab>('events');
  const stepUp = useStepUp();
  return (
    <PageContainer>
      <PageHeader title={t('title')} description={t('intro')} />
      <LoginFailuresCard run={stepUp.run} />
      <div role="tablist" aria-label={t('title')} className="flex gap-1 border-b border-border">
        {(['events', 'errors'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-3 py-2 text-body-sm focus-visible:focus-ring ${
              tab === k
                ? 'border-primary font-medium text-fg'
                : 'border-transparent text-fg-muted hover:text-fg'
            }`}
          >
            {k === 'events' ? t('events') : t('errorsTitle')}
          </button>
        ))}
      </div>
      {tab === 'events' ? <EventsPanel run={stepUp.run} /> : <ErrorsPanel run={stepUp.run} />}
      <p className="text-caption text-fg-subtle">{t('privacy')}</p>
      {stepUp.dialog}
    </PageContainer>
  );
}

type Run = <T>(fn: () => Promise<T>) => Promise<T>;

function EventsPanel({ run }: { run: Run }) {
  const t = useTranslations('audit');
  const format = useFormatter();
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<AuditEventDtoValue[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'range'>('loading');

  const load = useCallback(
    async (f: AuditFilters, cursor?: string) => {
      if (cursor === undefined) setState('loading');
      try {
        const r = await run(() =>
          adminFetch<AuditEventsResponseValue>(
            `/audit/events?${buildEventsQuery(f, cursor).toString()}`,
          ),
        );
        setItems((cur) => (cursor ? [...cur, ...r.items] : r.items));
        setNext(r.nextCursor);
        setState('ready');
      } catch (e) {
        setState((e as { status?: number }).status === 422 ? 'range' : 'error');
      }
    },
    [run],
  );
  useEffect(() => {
    void load(applied);
  }, [load, applied]);

  const incomplete = isRangeIncomplete(draft);
  const inverted = isRangeInverted(draft);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

  return (
    <>
      <Card className="flex flex-col gap-3 p-5">
        <h2 className="text-title text-fg">{t('filters')}</h2>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!incomplete && !inverted) setApplied(draft);
          }}
        >
          <Field label={t('action')}>
            <Select
              value={draft.action}
              onChange={(e) => setDraft({ ...draft, action: e.target.value })}
              options={[
                { value: '', label: t('actionAll') },
                ...AUDIT_ACTIONS.map((a) => ({ value: a, label: a })),
              ]}
            />
          </Field>
          <Field label={t('actorType')}>
            <Select
              value={draft.actorType}
              onChange={(e) => setDraft({ ...draft, actorType: e.target.value })}
              options={[
                { value: '', label: t('actorAll') },
                ...AUDIT_ACTOR_TYPES.map((a) => ({ value: a, label: t(`actorTypes.${a}`) })),
              ]}
            />
          </Field>
          <Field label={t('from')}>
            <Input
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </Field>
          <Field label={t('to')}>
            <Input
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </Field>
          <p className="text-caption text-fg-muted sm:col-span-2 lg:col-span-4">
            {incomplete ? t('rangeIncomplete') : inverted ? t('rangeInverted') : t('rangeHint')}
          </p>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" size="sm" disabled={incomplete || inverted}>
              {t('apply')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY_FILTERS);
                setApplied(EMPTY_FILTERS);
              }}
            >
              {t('reset')}
            </Button>
          </div>
        </form>
      </Card>

      {state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {(state === 'error' || state === 'range') && (
        <ErrorState
          title={state === 'range' ? t('rangeError') : t('error')}
          onRetry={() => void load(applied)}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      )}
      {state === 'ready' && items.length === 0 && (
        <EmptyState icon="nav.search" title={t('empty')} description={t('emptyBody')} />
      )}
      {state === 'ready' && items.length > 0 && (
        <Table caption={t('events')}>
          <thead>
            <tr>
              <Th>{t('colTime')}</Th>
              <Th>{t('colAction')}</Th>
              <Th>{t('colActor')}</Th>
              <Th>{t('colTarget')}</Th>
              <Th>{t('colMeta')}</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const meta = metadataRows(e.metadata);
              return (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap tabular-nums">{when(e.at)}</Td>
                  <Td>
                    <p className="text-caption text-fg-subtle">{t(`group.${groupOf(e.action)}`)}</p>
                    <p className="font-mono text-body-sm text-fg">{e.action}</p>
                  </Td>
                  <Td>
                    <Badge tone={e.actorType === 'platform_staff' ? 'info' : 'neutral'}>
                      {t(`actorTypes.${e.actorType}`)}
                    </Badge>
                    {e.actorId && (
                      <p className="font-mono text-caption text-fg-muted">
                        {e.actorId.slice(0, 8)}
                      </p>
                    )}
                    {e.orgId && (
                      <p className="font-mono text-caption text-fg-muted">
                        {t('orgLabel')} {e.orgId.slice(0, 8)}
                      </p>
                    )}
                  </Td>
                  <Td>
                    {e.targetType ? (
                      <>
                        <p className="text-body-sm text-fg">{e.targetType}</p>
                        {e.targetId && (
                          <p className="font-mono text-caption text-fg-muted">
                            {e.targetId.slice(0, 8)}
                          </p>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td>
                    {meta.length === 0 ? (
                      t('noMeta')
                    ) : (
                      <dl className="flex flex-col gap-0.5">
                        {meta.map((m) => (
                          <div key={m.key} className="flex gap-1.5 text-caption">
                            <dt className="text-fg-subtle">{m.key}</dt>
                            <dd className="font-mono text-fg">{m.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {state === 'ready' && next && (
        <Button variant="outline" onClick={() => void load(applied, next)}>
          {t('more')}
        </Button>
      )}
    </>
  );
}

function ErrorsPanel({ run }: { run: Run }) {
  const t = useTranslations('audit');
  const format = useFormatter();
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<AuditErrorsResponseValue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [tableFor, setTableFor] = useState<string | null>(null);

  const load = useCallback(
    async (r: Range) => {
      setState('loading');
      const to = new Date();
      const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (r - 1));
      try {
        setData(
          await run(() =>
            adminFetch<AuditErrorsResponseValue>(
              `/audit/errors?from=${isoDay(from)}&to=${isoDay(to)}`,
            ),
          ),
        );
        setState('ready');
      } catch {
        setState('error');
      }
    },
    [run],
  );
  useEffect(() => {
    void load(range);
  }, [load, range]);

  const num = (v: number) => format.number(v);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-body-sm text-fg-muted">{t('errorsIntro')}</p>
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
      </div>
      {state === 'loading' && (
        <div aria-busy="true" className="grid gap-4 md:grid-cols-3">
          <span className="sr-only">{t('loading')}</span>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-36 w-full" />
          ))}
        </div>
      )}
      {state === 'error' && (
        <ErrorState
          title={t('errorsError')}
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
      {state === 'ready' && data && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {AUDIT_ERROR_SOURCES.map((s) => {
              const f = SOURCE_FIELD[s];
              return (
                <Card key={s} className="flex flex-col gap-2 p-5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-body-sm font-medium text-fg">{t(`source.${s}`)}</h3>
                    <p className="font-display text-title text-fg tabular-nums">
                      {num(data.totals[f])}
                    </p>
                  </div>
                  <BarSeries values={data.daily.map((d) => d[f])} className="text-danger" />
                  <p className="text-caption text-fg-subtle">{t(`sourceNote.${s}`)}</p>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={tableFor === s}
                    onClick={() => setTableFor(tableFor === s ? null : s)}
                  >
                    {tableFor === s ? t('hideTable') : t('showTable')}
                  </Button>
                  {tableFor === s && (
                    <Table caption={t(`source.${s}`)}>
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
                            <Td className="tabular-nums">{num(d[f])}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card>
              );
            })}
          </div>
          <section aria-labelledby="top" className="flex flex-col gap-3">
            <h2 id="top" className="text-title text-fg">
              {t('topTitle')}
            </h2>
            {data.top.length === 0 ? (
              <p className="text-body-sm text-fg-muted">{t('topEmpty')}</p>
            ) : (
              <Table caption={t('topTitle')}>
                <thead>
                  <tr>
                    <Th>{t('colSource')}</Th>
                    <Th>{t('colKind')}</Th>
                    <Th>{t('colCount')}</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.top.map((r) => (
                    <Tr key={`${r.source}:${r.key}`}>
                      <Td>{t(`source.${r.source}`)}</Td>
                      <Td className="font-mono">{r.key}</Td>
                      <Td className="tabular-nums">{num(r.count)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="text-caption text-fg-subtle">{t('queueNote')}</p>
          </section>
        </>
      )}
    </>
  );
}
