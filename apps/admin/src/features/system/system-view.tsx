'use client';
// Sistem: servis durumu, valkey-cache sayaçları, kuyruk özeti ve veritabanı özeti. Salt okur; yalnız
// sayaç, boyut ve durum gösterilir (anahtar adı, iş yükü, sorgu yok). Renk tek başına anlam taşımaz.
import type { AdminSystemDtoValue } from '@eda/contracts/api/admin-system';
import {
  Badge,
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
import { useCallback, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/admin-api.ts';
import { BackupCard } from './backup-card.tsx';
import { formatBytes, overallState, queueTotals, STATE_ICON, STATE_TONE } from './model.ts';
import { SourceCanaryCard } from './source-canary-card.tsx';

type State = { kind: 'loading' } | { kind: 'ready'; data: AdminSystemDtoValue } | { kind: 'error' };

function Stat({ label, value, hint }: { label: string; value: string; hint?: string | undefined }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-caption text-fg-subtle">{label}</p>
      <p className="font-display text-heading-lg text-fg tabular-nums">{value}</p>
      {hint && <p className="text-caption text-fg-muted">{hint}</p>}
    </Card>
  );
}

export function SystemView() {
  const t = useTranslations('system');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      setState({ kind: 'ready', data: await adminFetch<AdminSystemDtoValue>('/system') });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const n = (v: number) => format.number(v);
  const bytes = (v: number) => {
    const b = formatBytes(v);
    return `${format.number(b.value, { maximumFractionDigits: 1 })} ${b.unit}`;
  };
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const unavailable = <p className="text-body-sm text-fg-muted">{t('unavailable')}</p>;

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
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <span className="sr-only">{t('loading')}</span>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </PageContainer>
    );
  }

  const d = state.data;
  const overall = overallState(d.services);
  const totals = queueTotals(d.queues.items);
  const hitPct =
    d.cache.hitRate === null
      ? '—'
      : format.number(d.cache.hitRate, { style: 'percent', maximumFractionDigits: 1 });

  return (
    <PageContainer>
      <PageHeader
        title={t('title')}
        description={t('intro')}
        actions={
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('refresh')}
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATE_TONE[overall]} icon={STATE_ICON[overall]} size="md">
          {t(`overall.${overall}`)}
        </Badge>
        <Badge tone={d.maintenanceMode ? 'warning' : 'neutral'} size="md">
          {d.maintenanceMode ? t('maintenanceOn') : t('maintenanceOff')}
        </Badge>
        <span className="text-caption text-fg-subtle">
          {t('generatedAt', { time: time(d.generatedAt) })}
        </span>
      </div>

      <section aria-labelledby="servisler" className="flex flex-col gap-3">
        <h2 id="servisler" className="text-title text-fg">
          {t('services')}
        </h2>
        {d.services.length === 0 ? (
          unavailable
        ) : (
          <Table caption={t('services')}>
            <thead>
              <tr>
                <Th>{t('service')}</Th>
                <Th>{t('state')}</Th>
                <Th>{t('latency')}</Th>
                <Th>{t('checkedAt')}</Th>
              </tr>
            </thead>
            <tbody>
              {d.services.map((s) => (
                <Tr key={s.key}>
                  <Td>
                    {t(`svc.${s.key}`)}
                    <span className="ml-2 text-caption text-fg-subtle">
                      {s.hard ? t('hard') : t('soft')}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={STATE_TONE[s.state]} icon={STATE_ICON[s.state]}>
                      {t(`stateLabel.${s.state}`)}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums">{t('ms', { value: n(s.latencyMs) })}</Td>
                  <Td className="tabular-nums">{time(s.checkedAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="onbellek" className="flex flex-col gap-3">
        <h2 id="onbellek" className="text-title text-fg">
          {t('cache')}
        </h2>
        {d.cache.available ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label={t('hitRate')}
              value={hitPct}
              hint={t('hitMiss', { hits: n(d.cache.hits), misses: n(d.cache.misses) })}
            />
            <Stat
              label={t('memory')}
              value={bytes(d.cache.usedMemoryBytes)}
              hint={
                d.cache.maxMemoryBytes > 0
                  ? t('memoryLimit', { limit: bytes(d.cache.maxMemoryBytes) })
                  : t('memoryUnlimited')
              }
            />
            <Stat label={t('keys')} value={n(d.cache.keys)} />
            <Stat
              label={t('evicted')}
              value={n(d.cache.evictedKeys)}
              hint={t('expired', { count: n(d.cache.expiredKeys) })}
            />
          </div>
        ) : (
          unavailable
        )}
        <p className="text-caption text-fg-subtle">{t('cacheNote')}</p>
      </section>

      <section aria-labelledby="kuyruklar" className="flex flex-col gap-3">
        <h2 id="kuyruklar" className="text-title text-fg">
          {t('queues')}
        </h2>
        {!d.queues.available && unavailable}
        {d.queues.items.length > 0 && (
          <Table caption={t('queues')}>
            <thead>
              <tr>
                <Th>{t('queue')}</Th>
                <Th>{t('waiting')}</Th>
                <Th>{t('active')}</Th>
                <Th>{t('failed')}</Th>
                <Th>{t('delayed')}</Th>
              </tr>
            </thead>
            <tbody>
              {d.queues.items.map((q) => (
                <Tr key={q.name}>
                  <Td>{q.name}</Td>
                  <Td className="tabular-nums">{n(q.waiting)}</Td>
                  <Td className="tabular-nums">{n(q.active)}</Td>
                  <Td className="tabular-nums">
                    {q.failed > 0 ? (
                      <Badge tone="danger" icon="notice.error">
                        {n(q.failed)}
                      </Badge>
                    ) : (
                      n(q.failed)
                    )}
                  </Td>
                  <Td className="tabular-nums">{n(q.delayed)}</Td>
                </Tr>
              ))}
              <Tr>
                <Td className="font-medium">{t('total')}</Td>
                <Td className="tabular-nums">{n(totals.waiting)}</Td>
                <Td className="tabular-nums">{n(totals.active)}</Td>
                <Td className="tabular-nums">{n(totals.failed)}</Td>
                <Td className="tabular-nums">{n(totals.delayed)}</Td>
              </Tr>
            </tbody>
          </Table>
        )}
      </section>

      <section aria-labelledby="veritabani" className="flex flex-col gap-3">
        <h2 id="veritabani" className="text-title text-fg">
          {t('database')}
        </h2>
        {d.database.available ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Stat label={t('dbSize')} value={bytes(d.database.databaseBytes)} />
              <Stat
                label={t('connections')}
                value={n(d.database.connections.total)}
                hint={t('connectionsMax', { max: n(d.database.connections.max) })}
              />
            </div>
            <Table caption={t('schemas')}>
              <thead>
                <tr>
                  <Th>{t('schema')}</Th>
                  <Th>{t('tables')}</Th>
                  <Th>{t('totalSize')}</Th>
                  <Th>{t('indexSize')}</Th>
                  <Th>{t('estRows')}</Th>
                </tr>
              </thead>
              <tbody>
                {d.database.schemas.map((s) => (
                  <Tr key={s.schema}>
                    <Td>{s.schema}</Td>
                    <Td className="tabular-nums">{n(s.tables)}</Td>
                    <Td className="tabular-nums">{bytes(s.totalBytes)}</Td>
                    <Td className="tabular-nums">{bytes(s.indexBytes)}</Td>
                    <Td className="tabular-nums">{n(s.estimatedRows)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            <Table caption={t('topTables')}>
              <thead>
                <tr>
                  <Th>{t('table')}</Th>
                  <Th>{t('totalSize')}</Th>
                  <Th>{t('indexSize')}</Th>
                  <Th>{t('estRows')}</Th>
                </tr>
              </thead>
              <tbody>
                {d.database.topTables.map((r) => (
                  <Tr key={r.table}>
                    <Td>{r.table}</Td>
                    <Td className="tabular-nums">{bytes(r.totalBytes)}</Td>
                    <Td className="tabular-nums">{bytes(r.indexBytes)}</Td>
                    <Td className="tabular-nums">{n(r.estimatedRows)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </>
        ) : (
          unavailable
        )}
      </section>
      <BackupCard backup={d.backup} />

      <SourceCanaryCard canary={d.sourceCanary} />
      <p className="text-caption text-fg-subtle">{t('privacy')}</p>
    </PageContainer>
  );
}
