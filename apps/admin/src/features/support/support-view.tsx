'use client';
// Destek: `support` ve `super_admin` için toplulaştırılmış iş listesi (bekleyen başvurular, askıdaki
// hesaplar, doğrulama bekleyen e-postalar) ve destek talebi kuyruğu. Talep konusu/gövdesi GÖSTERİLMEZ.
// Durum değiştirme yalnız `super_admin` (yeniden doğrulama + denetim kaydı).
import type { AdminMeDtoValue } from '@eda/contracts/api/admin';
import type {
  AdminSupportOverviewDtoValue,
  AdminTicketDtoValue,
  AdminTicketListResponseValue,
  SetTicketStatusInputValue,
} from '@eda/contracts/api/admin-support';
import { SUPPORT_TICKET_STATUSES } from '@eda/contracts/enums';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Tabs,
  Td,
  Th,
  Tr,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';

type Tab = 'work' | 'tickets';
type TicketStatus = SetTicketStatusInputValue['status'];
type Filter = 'all' | TicketStatus;
const FILTERS: readonly Filter[] = ['all', ...SUPPORT_TICKET_STATUSES];

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; data: AdminSupportOverviewDtoValue; role: AdminMeDtoValue['platformRole'] }
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

export function SupportView() {
  const t = useTranslations('support');
  const format = useFormatter();
  const stepUp = useStepUp();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>('work');
  const [filter, setFilter] = useState<Filter>('all');
  const [tickets, setTickets] = useState<AdminTicketDtoValue[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [ticketState, setTicketState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<AdminTicketDtoValue | null>(null);
  const [newStatus, setNewStatus] = useState<TicketStatus>('in_progress');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const [data, me] = await Promise.all([
        adminFetch<AdminSupportOverviewDtoValue>('/support/overview'),
        adminFetch<AdminMeDtoValue>('/me'),
      ]);
      setState({ kind: 'ready', data, role: me.platformRole });
    } catch {
      setState({ kind: 'error' });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const loadTickets = useCallback(async (f: Filter, cursor?: string) => {
    if (cursor === undefined) setTicketState('loading');
    try {
      const q = new URLSearchParams();
      if (f !== 'all') q.set('status', f);
      if (cursor) q.set('cursor', cursor);
      const r = await adminFetch<AdminTicketListResponseValue>(`/support/tickets?${q.toString()}`);
      setTickets((cur) => (cursor ? [...cur, ...r.items] : r.items));
      setNext(r.nextCursor);
      setTicketState('ready');
    } catch {
      setTicketState('error');
    }
  }, []);
  useEffect(() => {
    if (tab === 'tickets') void loadTickets(filter);
  }, [tab, filter, loadTickets]);

  async function changeStatus() {
    if (editing === null) return;
    setBusy(true);
    setActionError(null);
    try {
      await stepUp.run(() =>
        adminFetch(`/support/tickets/${editing.ticketId}/status`, {
          method: 'POST',
          body: { status: newStatus } satisfies SetTicketStatusInputValue,
        }),
      );
      setEditing(null);
      void loadTickets(filter);
      void load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setActionError(code === 'VALIDATION_CONFLICT' ? t('stateChanged') : t('actionError'));
    } finally {
      setBusy(false);
    }
  }

  const when = (iso: string | null) =>
    iso === null
      ? '—'
      : format.dateTime(new Date(iso), {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
        });
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { day: 'numeric', month: 'long', year: 'numeric' });

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
        <div aria-busy="true" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <span className="sr-only">{t('loading')}</span>
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </PageContainer>
    );
  }

  const { counts, items } = state.data;
  const canWrite = state.role === 'super_admin';
  const n = (v: number) => format.number(v);
  const oldest = (iso: string | null) => (iso ? t('oldest', { date: day(iso) }) : undefined);

  return (
    <PageContainer width="content">
      <PageHeader title={t('title')} description={t('intro')} />
      <section aria-label={t('summary')} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={t('count.pendingApplications')}
          value={n(counts.pendingApplications)}
          hint={oldest(counts.oldestPendingAt)}
        />
        <Stat label={t('count.suspendedUsers')} value={n(counts.suspendedUsers)} />
        <Stat label={t('count.suspendedOrgs')} value={n(counts.suspendedOrgs)} />
        <Stat
          label={t('count.unverifiedEmails')}
          value={n(counts.unverifiedEmails)}
          hint={oldest(counts.oldestUnverifiedAt)}
        />
        <Stat
          label={t('count.open')}
          value={n(counts.tickets.open)}
          hint={oldest(counts.tickets.oldestOpenAt)}
        />
        <Stat label={t('count.inProgress')} value={n(counts.tickets.inProgress)} />
        <Stat label={t('count.waiting')} value={n(counts.tickets.waiting)} />
        <Stat label={t('count.urgent')} value={n(counts.tickets.urgent)} />
      </section>
      <Tabs
        value={tab}
        onValueChange={setTab}
        label={t('tabs')}
        items={[
          { value: 'work', label: t('tab.work'), count: items.length },
          { value: 'tickets', label: t('tab.tickets') },
        ]}
      />
      {tab === 'work' &&
        (items.length === 0 ? (
          <EmptyState icon="status.verified" title={t('emptyWork')} />
        ) : (
          <Table caption={t('workCaption')}>
            <thead>
              <tr>
                <Th>{t('col.kind')}</Th>
                <Th>{t('col.party')}</Th>
                <Th>{t('col.status')}</Th>
                <Th>{t('col.since')}</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <Tr key={`${i.kind}:${i.refId}`}>
                  <Td>{t(`workKind.${i.kind}`)}</Td>
                  <Td>{i.partyEmail}</Td>
                  <Td>
                    <Badge tone={i.kind === 'pending_application' ? 'warning' : 'neutral'}>
                      {t(
                        `verification.${i.kind === 'unverified_email' ? 'unverified' : (i.status as 'pending_verification' | 'suspended')}`,
                      )}
                    </Badge>
                  </Td>
                  <Td className="tabular-nums">{when(i.sinceAt)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ))}
      {tab === 'tickets' && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label={t('ticketFilter')}>
              <Select
                value={filter}
                onChange={(e) => setFilter(e.target.value as Filter)}
                options={FILTERS.map((f) => ({ value: f, label: t(`filter.${f}`) }))}
              />
            </Field>
            <p className="text-body-sm text-fg-muted">{t('contentHidden')}</p>
          </div>
          {!canWrite && <p className="text-body-sm text-fg-muted">{t('readOnly')}</p>}
          {ticketState === 'loading' && (
            <div aria-busy="true" className="flex flex-col gap-3">
              <span className="sr-only">{t('loading')}</span>
              <Skeleton className="h-24 w-full" />
            </div>
          )}
          {ticketState === 'error' && (
            <ErrorState
              title={t('error')}
              onRetry={() => void loadTickets(filter)}
              labels={{
                retry: t('retry'),
                retrying: t('loading'),
                supportCode: '',
                copy: '',
                copied: '',
              }}
            />
          )}
          {ticketState === 'ready' && tickets.length === 0 && (
            <EmptyState icon="nav.support" title={t('emptyTickets')} />
          )}
          {ticketState === 'ready' && tickets.length > 0 && (
            <Table caption={t('ticketCaption')}>
              <thead>
                <tr>
                  <Th>{t('col.category')}</Th>
                  <Th>{t('col.priority')}</Th>
                  <Th>{t('col.status')}</Th>
                  <Th>{t('col.orgKind')}</Th>
                  <Th>{t('col.requester')}</Th>
                  <Th>{t('col.created')}</Th>
                  <Th>{t('col.updated')}</Th>
                  {canWrite && <Th>{t('col.actions')}</Th>}
                </tr>
              </thead>
              <tbody>
                {tickets.map((k) => (
                  <Tr key={k.ticketId}>
                    <Td>{t(`category.${k.category}`)}</Td>
                    <Td>
                      <Badge
                        tone={
                          k.priority === 'urgent'
                            ? 'danger'
                            : k.priority === 'high'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(`priority.${k.priority}`)}
                      </Badge>
                    </Td>
                    <Td>{t(`status.${k.status}`)}</Td>
                    <Td>{t(`orgKind.${k.orgKind as 'individual' | 'firm'}`)}</Td>
                    <Td>{k.requesterEmail ?? '—'}</Td>
                    <Td className="tabular-nums">{when(k.createdAt)}</Td>
                    <Td className="tabular-nums">{when(k.updatedAt)}</Td>
                    {canWrite && (
                      <Td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setActionError(null);
                            setNewStatus(k.status === 'open' ? 'in_progress' : 'closed');
                            setEditing(k);
                          }}
                        >
                          {t('changeStatus')}
                        </Button>
                      </Td>
                    )}
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {next && (
            <Button variant="outline" onClick={() => void loadTickets(filter, next)}>
              {t('more')}
            </Button>
          )}
        </>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(o) => {
          if (!o) setEditing(null);
        }}
        title={t('dialogTitle')}
        description={t('dialogBody')}
        labels={{ close: t('close') }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
            <Button loading={busy} loadingLabel={t('working')} onClick={() => void changeStatus()}>
              {t('confirm')}
            </Button>
          </>
        }
      >
        <Field label={t('newStatus')}>
          <Select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value as TicketStatus)}
            options={SUPPORT_TICKET_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))}
          />
        </Field>
        {actionError && (
          <p role="alert" className="mt-2 text-body-sm text-danger">
            {actionError}
          </p>
        )}
      </Dialog>
      {stepUp.dialog}
    </PageContainer>
  );
}
