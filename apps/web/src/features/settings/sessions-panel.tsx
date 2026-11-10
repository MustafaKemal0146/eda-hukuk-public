'use client';
// Etkin oturumlar: cihaz, son etkinlik, kısaltılmış ağ adresi; tek tek ya da topluca kapatma. Bu
// cihazın oturumu buradan kapatılmaz (çıkış hesap menüsündedir). Veri bu bileşende yüklenir.
import type { SessionDeviceDtoValue } from '@eda/contracts/api/me';
import { AlertDialog, Badge, Button, ErrorState, Icon, Skeleton } from '@eda/ui';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { loadSessions, revokeOtherSessions, revokeSession } from './sessions-api.ts';
import { deviceLabel } from './user-agent.ts';

type Load = 'loading' | 'ready' | 'error';

export function SessionsPanel() {
  const t = useTranslations('settings.sessions');
  const format = useFormatter();
  const [state, setState] = useState<Load>('loading');
  const [items, setItems] = useState<SessionDeviceDtoValue[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    try {
      setItems(await loadSessions());
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    setBusy(id);
    setFailed(false);
    try {
      await revokeSession(id);
      setItems((cur) => cur.filter((s) => s.id !== id));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  async function revokeAll() {
    setBusy('all');
    setFailed(false);
    try {
      await revokeOtherSessions();
      setItems((cur) => cur.filter((s) => s.current));
      setConfirmAll(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  const others = items.filter((s) => !s.current).length;
  const when = (iso: string) =>
    format.relativeTime(new Date(iso), { now: new Date(), style: 'long' });

  return (
    <section
      aria-labelledby="oturumlar-baslik"
      className="rounded-lg border border-border bg-surface shadow-1"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <h2 id="oturumlar-baslik" className="text-title text-fg">
            {t('title')}
          </h2>
          <p className="mt-0.5 text-body-sm text-fg-muted">{t('body')}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={others === 0 || busy !== null}
          onClick={() => setConfirmAll(true)}
        >
          {t('revokeOthers')}
        </Button>
      </div>
      {failed && (
        <p role="alert" className="px-5 pt-4 text-body-sm text-danger">
          {t('failed')}
        </p>
      )}
      {state === 'loading' && (
        <div aria-busy="true" className="flex flex-col gap-3 px-5 py-5">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {state === 'error' && (
        <div className="px-5 py-5">
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
        </div>
      )}
      {state === 'ready' && (
        <ul className="divide-y divide-border">
          {items.map((s) => {
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                  <Icon icon="theme.system" size="md" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-body-sm font-medium text-fg">
                    {deviceLabel(s.userAgent, t('unknownDevice'))}
                    {s.current && <Badge tone="success">{t('thisDevice')}</Badge>}
                  </p>
                  <p className="mt-0.5 text-caption text-fg-muted">
                    {t('lastActive', { when: when(s.lastActiveAt) })}
                    {s.ipTrunc ? ` · ${s.ipTrunc}` : ''}
                    {` · ${t('since', {
                      date: format.dateTime(new Date(s.createdAt), {
                        day: 'numeric',
                        month: 'long',
                      }),
                    })}`}
                  </p>
                </div>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === s.id}
                    loadingLabel={t('revoking')}
                    disabled={busy !== null && busy !== s.id}
                    onClick={() => void revoke(s.id)}
                  >
                    {t('revoke')}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={t('confirmTitle')}
        description={t('confirmBody', { count: others })}
        cancelLabel={t('cancel')}
        destructiveLabel={t('revokeOthers')}
        confirmLoading={busy === 'all'}
        confirmLoadingLabel={t('revoking')}
        onConfirm={() => void revokeAll()}
      />
    </section>
  );
}
