'use client';
// Başvurular: meslek doğrulama kuyruğu (053-ekranlar/11 §3.2). Onay deneme ve kredi başlatır; ret yalnız
// kapalı gerekçe koduyla (serbest metin yok). Baro avukat arama sitesinde doğrulama dışarıda yapılır.
// Yazma işlemleri yeniden doğrulama (step-up) ister.
import {
  type AdminApplicationDtoValue,
  type AdminApplicationListResponseValue,
  REJECT_REASON_CODES,
} from '@eda/contracts/api/admin';
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
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';

type Tab = 'pending_verification' | 'verified' | 'rejected';
const TABS: readonly Tab[] = ['pending_verification', 'verified', 'rejected'];

export function ApplicationsView() {
  const t = useTranslations('applications');
  const format = useFormatter();
  const stepUp = useStepUp();
  const [tab, setTab] = useState<Tab>('pending_verification');
  const [items, setItems] = useState<AdminApplicationDtoValue[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<AdminApplicationDtoValue | null>(null);
  const [reason, setReason] =
    useState<(typeof REJECT_REASON_CODES)[number]>('not_found_in_registry');

  const load = useCallback(async (status: Tab, cursor?: string) => {
    if (cursor === undefined) setState('loading');
    try {
      const q = new URLSearchParams({ status });
      if (cursor) q.set('cursor', cursor);
      const r = await stepUp.run(() =>
        adminFetch<AdminApplicationListResponseValue>(`/applications?${q.toString()}`),
      );
      setItems((cur) => (cursor ? [...cur, ...r.items] : r.items));
      setNext(r.nextCursor);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  async function decide(a: AdminApplicationDtoValue, decision: 'approve' | 'reject') {
    setBusyId(a.userId);
    setActionError(null);
    try {
      await stepUp.run(() =>
        adminFetch(`/applications/${a.userId}/${decision}`, {
          method: 'POST',
          body: decision === 'reject' ? { reasonCode: reason } : {},
        }),
      );
      setItems((cur) => cur.filter((x) => x.userId !== a.userId));
      setRejecting(null);
    } catch (e) {
      const code = (e as { code?: string }).code;
      setActionError(
        code === 'VALIDATION_ROUTE_NOT_FOUND' ? t('alreadyDecided') : t('actionError'),
      );
      if (code === 'VALIDATION_ROUTE_NOT_FOUND')
        setItems((cur) => cur.filter((x) => x.userId !== a.userId));
    } finally {
      setBusyId(null);
    }
  }

  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });

  return (
    <PageContainer>
      <PageHeader title={t('title')} description={t('intro')} />
      <div role="tablist" aria-label={t('tabs')} className="flex gap-1 border-b border-border">
        {TABS.map((k) => (
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
            {t(`tab.${k}`)}
          </button>
        ))}
      </div>
      {actionError && (
        <p role="alert" className="text-body-sm text-danger">
          {actionError}
        </p>
      )}
      {state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {state === 'error' && (
        <ErrorState
          title={t('error')}
          onRetry={() => void load(tab)}
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
        <EmptyState icon="status.verified" title={t(`empty.${tab}`)} description={t('emptyBody')} />
      )}
      {state === 'ready' && items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.userId}>
              <Card className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-medium text-fg">{a.name}</p>
                    <p className="text-body-sm text-fg-muted">{a.email}</p>
                  </div>
                  <Badge
                    tone={
                      a.status === 'verified'
                        ? 'success'
                        : a.status === 'rejected'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {t(`tab.${a.status}`)}
                  </Badge>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-body-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-caption text-fg-subtle">{t('baro')}</dt>
                    <dd className="text-fg">{a.baro}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-subtle">
                      {a.sicilNo ? t('sicil') : t('trainee')}
                    </dt>
                    <dd className="text-fg tabular-nums">
                      {a.sicilNo ?? a.traineeRegistryNo ?? '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-subtle">{t('submitted')}</dt>
                    <dd className="text-fg tabular-nums">{when(a.submittedAt)}</dd>
                  </div>
                  {a.rejectionReason && (
                    <div className="sm:col-span-3">
                      <dt className="text-caption text-fg-subtle">{t('rejectionReason')}</dt>
                      <dd className="text-fg">{t(`reason.${a.rejectionReason}`)}</dd>
                    </div>
                  )}
                </dl>
                {a.status === 'pending_verification' && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button
                      size="sm"
                      loading={busyId === a.userId}
                      loadingLabel={t('working')}
                      onClick={() => void decide(a, 'approve')}
                    >
                      {t('approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === a.userId}
                      onClick={() => {
                        setActionError(null);
                        setRejecting(a);
                      }}
                    >
                      {t('reject')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Button variant="outline" onClick={() => void load(tab, next)}>
          {t('more')}
        </Button>
      )}
      <Dialog
        open={rejecting !== null}
        onOpenChange={(o) => {
          if (!o) setRejecting(null);
        }}
        title={t('rejectTitle')}
        description={rejecting ? t('rejectBody', { name: rejecting.name }) : undefined}
        labels={{ close: t('close') }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              {t('cancel')}
            </Button>
            <Button
              loading={busyId !== null}
              loadingLabel={t('working')}
              onClick={() => rejecting && void decide(rejecting, 'reject')}
            >
              {t('rejectConfirm')}
            </Button>
          </>
        }
      >
        <Field label={t('reasonLabel')} description={t('reasonHint')}>
          <Select
            value={reason}
            onChange={(e) => setReason(e.target.value as (typeof REJECT_REASON_CODES)[number])}
            options={REJECT_REASON_CODES.map((c) => ({ value: c, label: t(`reason.${c}`) }))}
          />
        </Field>
      </Dialog>
      {stepUp.dialog}
    </PageContainer>
  );
}
