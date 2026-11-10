'use client';
// Duyurular ve bildirimler (053-ekranlar/11 "Duyurular"): platform duyurusu yayımlama, düzenleme ve
// yayından kaldırma; bildirim gönderim özeti. Duyuru düz metindir (HTML yok); uygulamada kapatılabilir
// şerit olarak görünür. Yayımlama/düzenleme/kaldırma yeniden doğrulama (step-up) ister ve
// denetim kaydı üretir. `support` yalnız okur. Bildirim özeti kişi bazlı satır taşımaz.
import {
  type AdminAnnouncementDtoValue,
  type AdminAnnouncementListResponseValue,
  type AdminNotificationSummaryResponseValue,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_TITLE_MAX,
} from '@eda/contracts/api/admin-announcements';
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_SEVERITIES } from '@eda/contracts/enums';
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  NoticeBanner,
  PageContainer,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
} from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';
import {
  type AnnouncementForm,
  EMPTY_FORM,
  type FormField,
  formFrom,
  lastDays,
  readRate,
  toCreateInput,
  toUpdateInput,
} from './announcements-model.ts';

type Tab = 'announcements' | 'notifications';
const TABS: readonly Tab[] = ['announcements', 'notifications'];
const SEVERITY_TONE = { info: 'info', warning: 'warning', critical: 'danger' } as const;
const STATE_TONE = { active: 'success', scheduled: 'info', ended: 'neutral' } as const;
const SUMMARY_DAYS = 30;

export function AnnouncementsView({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations('announcements');
  const [tab, setTab] = useState<Tab>('announcements');

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
      {tab === 'announcements' ? <AnnouncementList canWrite={canWrite} /> : <NotificationSummary />}
    </PageContainer>
  );
}

function AnnouncementList({ canWrite }: { canWrite: boolean }) {
  const t = useTranslations('announcements');
  const format = useFormatter();
  const stepUp = useStepUp();
  const [items, setItems] = useState<AdminAnnouncementDtoValue[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [actionError, setActionError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ current: AdminAnnouncementDtoValue | null } | null>(null);
  const [form, setForm] = useState<AnnouncementForm>(EMPTY_FORM);
  const [fieldError, setFieldError] = useState<FormField | null>(null);
  const [saving, setSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState<AdminAnnouncementDtoValue | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (cursor?: string) => {
    if (cursor === undefined) setState('loading');
    try {
      const q = new URLSearchParams();
      if (cursor) q.set('cursor', cursor);
      const r = await adminFetch<AdminAnnouncementListResponseValue>(
        `/announcements${q.size > 0 ? `?${q.toString()}` : ''}`,
      );
      setItems((cur) => (cursor ? [...cur, ...r.items] : r.items));
      setNext(r.nextCursor);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

  function openEditor(current: AdminAnnouncementDtoValue | null) {
    setForm(current === null ? EMPTY_FORM : formFrom(current));
    setFieldError(null);
    setActionError(null);
    setEditor({ current });
  }

  async function save() {
    if (editor === null) return;
    const current = editor.current;
    const parsed = current === null ? toCreateInput(form) : toUpdateInput(form, current);
    if (!parsed.ok) {
      setFieldError(parsed.field);
      return;
    }
    setFieldError(null);
    setSaving(true);
    try {
      await stepUp.run(() =>
        current === null
          ? adminFetch('/announcements', { method: 'POST', body: parsed.value })
          : adminFetch(`/announcements/${current.id}`, { method: 'PATCH', body: parsed.value }),
      );
      setEditor(null);
      await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setActionError(code === 'VALIDATION_CONFLICT' ? t('alreadyEnded') : t('actionError'));
      setEditor(null);
    } finally {
      setSaving(false);
    }
  }

  async function withdraw(a: AdminAnnouncementDtoValue) {
    setBusy(true);
    setActionError(null);
    try {
      await stepUp.run(() =>
        adminFetch(`/announcements/${a.id}/withdraw`, { method: 'POST', body: {} }),
      );
      setWithdrawing(null);
      await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setActionError(code === 'VALIDATION_CONFLICT' ? t('alreadyEnded') : t('actionError'));
      setWithdrawing(null);
    } finally {
      setBusy(false);
    }
  }

  const set = <K extends keyof AnnouncementForm>(k: K, v: AnnouncementForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const err = (f: FormField) => (fieldError === f ? t(`formError.${f}`) : undefined);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-fg-muted">{canWrite ? t('writeHint') : t('readOnly')}</p>
        {canWrite && <Button onClick={() => openEditor(null)}>{t('new')}</Button>}
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
          onRetry={() => void load()}
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
        <EmptyState icon="nav.notifications" title={t('empty')} description={t('emptyBody')} />
      )}
      {state === 'ready' && items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-body font-medium text-fg">{a.title}</p>
                    <p className="whitespace-pre-line text-body-sm text-fg-muted">{a.body}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={STATE_TONE[a.state]}>{t(`state.${a.state}`)}</Badge>
                    <Badge tone={SEVERITY_TONE[a.severity]}>{t(`severity.${a.severity}`)}</Badge>
                  </div>
                </div>
                <dl className="grid gap-x-6 gap-y-1 text-body-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-caption text-fg-subtle">{t('audienceLabel')}</dt>
                    <dd className="text-fg">{t(`audience.${a.audience}`)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-subtle">{t('from')}</dt>
                    <dd className="text-fg tabular-nums">{when(a.activeFrom)}</dd>
                  </div>
                  <div>
                    <dt className="text-caption text-fg-subtle">{t('until')}</dt>
                    <dd className="text-fg tabular-nums">
                      {a.activeUntil ? when(a.activeUntil) : t('open')}
                    </dd>
                  </div>
                </dl>
                {canWrite && a.state !== 'ended' && (
                  <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button size="sm" variant="outline" onClick={() => openEditor(a)}>
                      {t('edit')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setWithdrawing(a)}>
                      {t('withdraw')}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <Button variant="outline" onClick={() => void load(next)}>
          {t('more')}
        </Button>
      )}
      <Dialog
        open={editor !== null}
        onOpenChange={(o) => {
          if (!o) setEditor(null);
        }}
        title={editor?.current ? t('editTitle') : t('newTitle')}
        description={t('formIntro')}
        labels={{ close: t('close') }}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              {t('cancel')}
            </Button>
            <Button loading={saving} loadingLabel={t('working')} onClick={() => void save()}>
              {editor?.current ? t('save') : t('publish')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('severityLabel')}>
              <Select
                value={form.severity}
                onChange={(e) => set('severity', e.target.value as AnnouncementForm['severity'])}
                options={ANNOUNCEMENT_SEVERITIES.map((s) => ({
                  value: s,
                  label: t(`severity.${s}`),
                }))}
              />
            </Field>
            <Field label={t('audienceLabel')} description={t('audienceHint')}>
              <Select
                value={form.audience}
                onChange={(e) => set('audience', e.target.value as AnnouncementForm['audience'])}
                options={ANNOUNCEMENT_AUDIENCES.map((s) => ({
                  value: s,
                  label: t(`audience.${s}`),
                }))}
              />
            </Field>
          </div>
          <Field label={t('titleLabel')} error={err('title')} required>
            <Input
              value={form.title}
              maxLength={ANNOUNCEMENT_TITLE_MAX}
              onChange={(e) => set('title', e.target.value)}
            />
          </Field>
          <Field label={t('bodyLabel')} description={t('bodyHint')} error={err('body')} required>
            <Textarea
              value={form.body}
              rows={4}
              maxLength={ANNOUNCEMENT_BODY_MAX}
              onChange={(e) => set('body', e.target.value)}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('from')} description={t('fromHint')} error={err('activeFrom')}>
              <Input
                type="datetime-local"
                value={form.activeFrom}
                onChange={(e) => set('activeFrom', e.target.value)}
              />
            </Field>
            <Field label={t('until')} description={t('untilHint')} error={err('activeUntil')}>
              <Input
                type="datetime-local"
                value={form.activeUntil}
                onChange={(e) => set('activeUntil', e.target.value)}
              />
            </Field>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="text-caption text-fg-subtle">{t('preview')}</p>
            <NoticeBanner
              tone={SEVERITY_TONE[form.severity]}
              title={form.title || t('previewTitle')}
            >
              <span className="whitespace-pre-line">{form.body || t('previewBody')}</span>
            </NoticeBanner>
          </div>
        </div>
      </Dialog>
      <AlertDialog
        open={withdrawing !== null}
        onOpenChange={(o) => {
          if (!o) setWithdrawing(null);
        }}
        title={t('withdrawTitle')}
        description={withdrawing ? t('withdrawBody', { title: withdrawing.title }) : ''}
        cancelLabel={t('cancel')}
        destructiveLabel={t('withdrawConfirm')}
        confirmLoading={busy}
        confirmLoadingLabel={t('working')}
        onConfirm={() => withdrawing && void withdraw(withdrawing)}
      />
      {stepUp.dialog}
    </>
  );
}

function NotificationSummary() {
  const t = useTranslations('announcements');
  const format = useFormatter();
  const [data, setData] = useState<AdminNotificationSummaryResponseValue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const { from, to } = lastDays(SUMMARY_DAYS, new Date());
      setData(
        await adminFetch<AdminNotificationSummaryResponseValue>(
          `/notifications/summary?from=${from}&to=${to}`,
        ),
      );
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const pct = (sent: number, read: number) => {
    const r = readRate(sent, read);
    return r === null ? '—' : `%${format.number(r)}`;
  };

  return (
    <>
      <p className="text-body-sm text-fg-muted">{t('summaryIntro', { days: SUMMARY_DAYS })}</p>
      <NoticeBanner tone="neutral" title={t('broadcastTitle')}>
        {t('broadcastBody')}
      </NoticeBanner>
      {state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-24 w-full" />
        </div>
      )}
      {state === 'error' && (
        <ErrorState
          title={t('summaryError')}
          onRetry={() => void load()}
          labels={{
            retry: t('retry'),
            retrying: t('loading'),
            supportCode: '',
            copy: '',
            copied: '',
          }}
        />
      )}
      {state === 'ready' && data && data.items.length === 0 && (
        <EmptyState
          icon="nav.notifications"
          title={t('summaryEmpty')}
          description={t('summaryEmptyBody')}
        />
      )}
      {state === 'ready' && data && data.items.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-body-sm">
            <caption className="sr-only">{t('summaryCaption')}</caption>
            <thead>
              <tr className="border-b border-border text-left text-caption text-fg-subtle">
                <th scope="col" className="px-4 py-2 font-medium">
                  {t('colType')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('colSent')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('colRead')}
                </th>
                <th scope="col" className="px-4 py-2 text-right font-medium">
                  {t('colRate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.type} className="border-b border-border last:border-0">
                  <th scope="row" className="px-4 py-2 text-left font-normal text-fg">
                    {t(`notificationType.${r.type}`)}
                  </th>
                  <td className="px-4 py-2 text-right tabular-nums">{format.number(r.sent)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{format.number(r.read)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pct(r.sent, r.read)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-medium">
                <th scope="row" className="px-4 py-2 text-left">
                  {t('total')}
                </th>
                <td className="px-4 py-2 text-right tabular-nums">
                  {format.number(data.totals.sent)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {format.number(data.totals.read)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {pct(data.totals.sent, data.totals.read)}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}
    </>
  );
}
