'use client';
// Kullanıcı ayrıntısı (053-ekranlar/11 §3.4): hesap durumu, MFA/passkey özeti, aktif oturum sayısı,
// kullanım sayaçları ve kullanıcıya özel limitler. İçerik yoktur. Değiştirici işlemler yalnız
// `super_admin` içindir (düğmeler `canWrite` ile gizlenir; asıl denetim api'dedir), passkey ile yeniden
// doğrulama ister. Modal içinde modal açılmaz: onaydan önce pencere kapatılır, sonra işlem çalışır.
import type {
  AdminUserDetailDtoValue,
  AdminUserLimitsInputValue,
} from '@eda/contracts/api/admin-users';
import { USER_SUSPEND_REASONS } from '@eda/contracts/enums';
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  Dialog,
  ErrorState,
  Field,
  Input,
  PageContainer,
  PageHeader,
  Progress,
  Select,
  Skeleton,
} from '@eda/ui';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useStepUp } from '../../components/step-up.tsx';
import { adminFetch } from '../../lib/admin-api.ts';
import { UserKeySection } from './user-key-section.tsx';
import {
  accountTone,
  canActOn,
  draftFromOverrides,
  LIMIT_FIELDS,
  type LimitDraft,
  type LimitField,
  parseLimitDraft,
  usagePercent,
  verificationTone,
} from './users-model.ts';

type State = 'loading' | 'ready' | 'error' | 'missing';
type Modal = null | 'suspend' | 'unsuspend' | 'revoke' | 'limits' | 'reset';

const USAGE_OF: Readonly<Record<LimitField, keyof AdminUserDetailDtoValue['usage']>> = {
  chatTurnsPerDay: 'chatTurnsToday',
  chatTurnsPerMonth: 'chatTurnsMonth',
  tokensPerDay: 'tokensToday',
  tokensPerMonth: 'tokensMonth',
};

export function UserDetailView({ userId, viewerRole }: { userId: string; viewerRole: string }) {
  const t = useTranslations('users');
  const format = useFormatter();
  const stepUp = useStepUp();
  const runStepUp = stepUp.run;
  const [data, setData] = useState<AdminUserDetailDtoValue | null>(null);
  const [state, setState] = useState<State>('loading');
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [reason, setReason] = useState<(typeof USER_SUSPEND_REASONS)[number]>('abuse');
  const [draft, setDraft] = useState<LimitDraft>({
    chatTurnsPerDay: '',
    chatTurnsPerMonth: '',
    tokensPerDay: '',
    tokensPerMonth: '',
  });
  const [badField, setBadField] = useState<LimitField | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const r = await runStepUp(() => adminFetch<AdminUserDetailDtoValue>(`/users/${userId}`));
      setData(r);
      setState('ready');
    } catch (e) {
      setState((e as { status?: number }).status === 404 ? 'missing' : 'error');
    }
  }, [runStepUp, userId]);
  useEffect(() => {
    void load();
  }, [load]);

  /** Pencereyi kapatır, passkey doğrulamasıyla işlemi çalıştırır ve sonucu bildirir. */
  async function act<T>(fn: () => Promise<T>, okText: string, apply?: (r: T) => void) {
    setModal(null);
    setBusy(true);
    setNotice(null);
    try {
      const r = await runStepUp(fn);
      apply?.(r);
      setNotice({ tone: 'ok', text: okText });
      if (apply === undefined) await load();
    } catch (e) {
      const code = (e as { code?: string }).code;
      setNotice({
        tone: 'error',
        text: code === 'RATE_LIMITED' ? t('rateLimited') : t('actionError'),
      });
    } finally {
      setBusy(false);
    }
  }

  const post = <T,>(path: string, body?: unknown) =>
    adminFetch<T>(`/users/${userId}${path}`, {
      method: 'POST',
      ...(body === undefined ? {} : { body }),
    });

  function openLimits() {
    if (data) setDraft(draftFromOverrides(data.limits.overrides));
    setBadField(null);
    setModal('limits');
  }

  function saveLimits() {
    const p = parseLimitDraft(draft);
    if (!p.ok) {
      setBadField(p.field);
      return;
    }
    const value: AdminUserLimitsInputValue = p.value;
    void act(() => post<AdminUserDetailDtoValue>('/limits', value), t('limitsSaved'), setData);
  }

  const dateTime = (iso: string | null) =>
    iso === null
      ? t('never')
      : format.dateTime(new Date(iso), {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
  const num = (v: number) => format.number(v);
  const limitText = (v: number | null) => (v === null ? t('unlimited') : num(v));

  const canWrite = data !== null && canActOn(viewerRole, data.user.platformRole);

  return (
    <PageContainer width="content">
      <PageHeader
        title={data ? data.user.userEmail : t('detail.title')}
        description={data ? t('detail.idLine', { id: data.user.shortId }) : undefined}
        actions={
          <Link
            href="/kullanicilar"
            className="rounded-sm text-body-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:focus-ring"
          >
            {t('detail.back')}
          </Link>
        }
      />
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-body-sm ${notice.tone === 'error' ? 'text-danger' : 'text-success'}`}
        >
          {notice.text}
        </p>
      )}
      {state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}
      {state === 'error' && (
        <ErrorState
          title={t('detail.error')}
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
      {state === 'missing' && <p className="text-body text-fg-muted">{t('detail.missing')}</p>}

      {state === 'ready' && data && (
        <>
          <Card className="flex flex-col gap-4 p-5">
            <h2 className="text-title text-fg">{t('detail.account')}</h2>
            <dl className="grid gap-x-6 gap-y-3 text-body-sm sm:grid-cols-3">
              <Item label={t('detail.status')}>
                <Badge tone={accountTone(data.account.status)}>
                  {t(`account.${data.account.status}`)}
                </Badge>
                {data.account.suspendReasonCode && (
                  <span className="ml-2 text-fg-muted">
                    {t(`reason.${data.account.suspendReasonCode}`)}
                  </span>
                )}
              </Item>
              <Item label={t('detail.role')}>{t(`role.${data.user.platformRole}`)}</Item>
              <Item label={t('table.verification')}>
                <Badge tone={verificationTone(data.user.verificationStatus)}>
                  {t(`verification.${data.user.verificationStatus}`)}
                </Badge>
                <span className="ml-2 text-fg-muted">
                  {data.user.emailVerified ? t('emailVerified') : t('emailUnverified')}
                </span>
              </Item>
              <Item label={t('table.created')}>{dateTime(data.user.createdAt)}</Item>
              <Item label={t('table.lastLogin')}>{dateTime(data.user.lastLoginAt)}</Item>
              <Item label={t('table.orgs')}>{num(data.user.orgCount)}</Item>
            </dl>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <h2 className="text-title text-fg">{t('detail.security')}</h2>
            <dl className="grid gap-x-6 gap-y-3 text-body-sm sm:grid-cols-3">
              <Item label={t('detail.passkeys')}>{num(data.security.passkeyCount)}</Item>
              <Item label={t('detail.totp')}>
                {data.security.totpEnabled ? t('detail.on') : t('detail.off')}
              </Item>
              <Item label={t('detail.sessions')}>{num(data.security.activeSessions)}</Item>
            </dl>
          </Card>

          <Card className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-title text-fg">{t('detail.limits')}</h2>
                <p className="text-body-sm text-fg-muted">{t('detail.limitsIntro')}</p>
              </div>
              {data.limits.overriddenAt && (
                <p className="text-caption text-fg-subtle">
                  {t('detail.overriddenAt', { when: dateTime(data.limits.overriddenAt) })}
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-body-sm">
                <caption className="sr-only">{t('detail.limitsCaption')}</caption>
                <thead>
                  <tr className="text-left text-caption text-fg-muted">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t('detail.metric')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      {t('detail.used')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      {t('detail.override')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      {t('detail.default')}
                    </th>
                    <th scope="col" className="px-4 py-2 text-right font-medium">
                      {t('detail.effective')}
                    </th>
                    <th scope="col" className="py-2 pl-4 font-medium">
                      {t('detail.ratio')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {LIMIT_FIELDS.map((f) => {
                    const used = data.usage[USAGE_OF[f]];
                    const pct = usagePercent(used, data.limits.effective[f]);
                    return (
                      <tr key={f} className="border-t border-border">
                        <th scope="row" className="py-2 pr-4 text-left font-normal text-fg">
                          {t(`limit.${f}`)}
                        </th>
                        <td className="px-4 py-2 text-right tabular-nums">{num(used)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {data.limits.overrides[f] === null ? '—' : num(data.limits.overrides[f])}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {limitText(data.limits.defaults[f])}
                        </td>
                        <td className="px-4 py-2 text-right font-medium tabular-nums">
                          {limitText(data.limits.effective[f])}
                        </td>
                        <td className="min-w-28 py-2 pl-4">
                          {pct === null ? (
                            <span className="text-fg-subtle">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Progress
                                value={pct}
                                label={t('detail.ratioOf', { name: t(`limit.${f}`) })}
                              />
                              <span className="text-caption tabular-nums text-fg-muted">
                                %{pct}
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-caption text-fg-subtle">
              {t('detail.conversations', { count: data.usage.conversationsTotal })}
            </p>
          </Card>

          {viewerRole === 'super_admin' && data.user.platformRole === 'user' && (
            <UserKeySection userId={userId} run={runStepUp} canWrite={canWrite} />
          )}

          {canWrite ? (
            <Card className="flex flex-col gap-3 p-5">
              <h2 className="text-title text-fg">{t('detail.actions')}</h2>
              <div className="flex flex-wrap gap-2">
                {data.account.status === 'active' ? (
                  <Button variant="outline" disabled={busy} onClick={() => setModal('suspend')}>
                    {t('action.suspend')}
                  </Button>
                ) : (
                  <Button variant="outline" disabled={busy} onClick={() => setModal('unsuspend')}>
                    {t('action.unsuspend')}
                  </Button>
                )}
                <Button variant="outline" disabled={busy} onClick={() => setModal('revoke')}>
                  {t('action.revoke')}
                </Button>
                <Button variant="outline" disabled={busy} onClick={openLimits}>
                  {t('action.limits')}
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || LIMIT_FIELDS.every((f) => data.limits.overrides[f] === null)}
                  onClick={() => setModal('reset')}
                >
                  {t('action.reset')}
                </Button>
              </div>
            </Card>
          ) : (
            <p className="text-body-sm text-fg-muted">
              {data.user.platformRole === 'user' ? t('readOnlyNote') : t('staffNote')}
            </p>
          )}

          <Dialog
            open={modal === 'suspend'}
            onOpenChange={(o) => !o && setModal(null)}
            title={t('suspend.title')}
            description={t('suspend.body')}
            labels={{ close: t('close') }}
            footer={
              <>
                <Button variant="ghost" onClick={() => setModal(null)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={() =>
                    void act(
                      () => post('/suspend', { suspended: true, reasonCode: reason }),
                      t('suspend.done'),
                    )
                  }
                >
                  {t('suspend.confirm')}
                </Button>
              </>
            }
          >
            <Field label={t('suspend.reasonLabel')} description={t('suspend.reasonHint')}>
              <Select
                value={reason}
                onChange={(e) => setReason(e.target.value as (typeof USER_SUSPEND_REASONS)[number])}
                options={USER_SUSPEND_REASONS.map((c) => ({ value: c, label: t(`reason.${c}`) }))}
              />
            </Field>
          </Dialog>

          <AlertDialog
            open={modal === 'unsuspend'}
            onOpenChange={(o) => !o && setModal(null)}
            title={t('unsuspend.title')}
            description={t('unsuspend.body')}
            cancelLabel={t('cancel')}
            destructiveLabel={t('unsuspend.confirm')}
            tone="primary"
            onConfirm={() =>
              void act(() => post('/suspend', { suspended: false }), t('unsuspend.done'))
            }
          />
          <AlertDialog
            open={modal === 'revoke'}
            onOpenChange={(o) => !o && setModal(null)}
            title={t('revoke.title')}
            description={t('revoke.body')}
            cancelLabel={t('cancel')}
            destructiveLabel={t('revoke.confirm')}
            onConfirm={() => void act(() => post('/sessions/revoke'), t('revoke.done'))}
          />
          <AlertDialog
            open={modal === 'reset'}
            onOpenChange={(o) => !o && setModal(null)}
            title={t('reset.title')}
            description={t('reset.body')}
            cancelLabel={t('cancel')}
            destructiveLabel={t('reset.confirm')}
            onConfirm={() =>
              void act(
                () => post<AdminUserDetailDtoValue>('/limits/reset'),
                t('reset.done'),
                setData,
              )
            }
          />
          <Dialog
            open={modal === 'limits'}
            onOpenChange={(o) => !o && setModal(null)}
            title={t('limitsForm.title')}
            description={t('limitsForm.body')}
            labels={{ close: t('close') }}
            footer={
              <>
                <Button variant="ghost" onClick={() => setModal(null)}>
                  {t('cancel')}
                </Button>
                <Button onClick={saveLimits}>{t('limitsForm.save')}</Button>
              </>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {LIMIT_FIELDS.map((f) => (
                <Field
                  key={f}
                  label={t(`limit.${f}`)}
                  description={t('limitsForm.defaultIs', {
                    value: limitText(data.limits.defaults[f]),
                  })}
                  error={badField === f ? t('limitsForm.invalid') : undefined}
                >
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft[f]}
                    placeholder={t('limitsForm.placeholder')}
                    onChange={(e) => setDraft({ ...draft, [f]: e.target.value })}
                  />
                </Field>
              ))}
            </div>
          </Dialog>
        </>
      )}
      {stepUp.dialog}
    </PageContainer>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-fg-subtle">{label}</dt>
      <dd className="text-fg">{children}</dd>
    </div>
  );
}
