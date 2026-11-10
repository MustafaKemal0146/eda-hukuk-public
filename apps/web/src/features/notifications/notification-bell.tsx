'use client';
// Bildirim zili ve paneli (045 §6; 053 kabuk): okunmamış sayısı rozeti, panel, okundu/tümünü okundu,
// imleçli yükleme. Yenileme: açılışta, panel açılınca ve pencere odağa dönünce (aralıklı yoklama yok).
// Panelde yalnız tür etiketi + zaman görünür; içerik yoktur. Oturum/MFA hatasında yönlendirilir.
import type { NotificationDtoValue } from '@eda/contracts/api/notifications';
import { Button, Icon, IconButton, Popover, Skeleton } from '@eda/ui';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authRedirectFor, documentsApi } from '../studio/documents-api.ts';
import { badgeText, linkFor, mergePages } from './notification-model.ts';

type State = {
  items: NotificationDtoValue[];
  nextCursor: string | null;
  unread: number;
  status: 'idle' | 'loading' | 'error';
};

export function NotificationBell() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<State>({ items: [], nextCursor: null, unread: 0, status: 'idle' });
  const busy = useRef(false);

  const load = useCallback(
    async (cursor?: string) => {
      if (busy.current) return;
      busy.current = true;
      setS((p) => ({ ...p, status: 'loading' }));
      try {
        const r = await documentsApi.notifications.list(cursor ? { cursor } : {});
        setS((p) => ({
          items: cursor ? mergePages(p.items, r.items) : r.items,
          nextCursor: r.nextCursor,
          unread: r.unreadCount,
          status: 'idle',
        }));
      } catch (err) {
        const to = authRedirectFor(err, '/sohbet');
        if (to) router.replace(to);
        else setS((p) => ({ ...p, status: 'error' }));
      } finally {
        busy.current = false;
      }
    },
    [router],
  );

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  const markRead = async (n: NotificationDtoValue) => {
    if (n.readAt !== null) return;
    setS((p) => ({
      ...p,
      unread: Math.max(0, p.unread - 1),
      items: p.items.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)),
    }));
    try {
      await documentsApi.notifications.markRead(n.id);
    } catch {
      void load();
    }
  };

  const readAll = async () => {
    try {
      await documentsApi.notifications.readAll();
      setS((p) => ({
        ...p,
        unread: 0,
        items: p.items.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })),
      }));
    } catch {
      setS((p) => ({ ...p, status: 'error' }));
    }
  };

  const badge = badgeText(s.unread);
  const label = s.unread > 0 ? t('bellWithCount', { count: s.unread }) : t('bell');

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
      title={t('title')}
      labels={{ close: t('close') }}
      align="end"
      size="md"
      trigger={
        <span className="relative inline-flex">
          <IconButton icon="nav.notifications" label={label} />
          {badge && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-caption font-semibold text-on-primary tabular-nums"
            >
              {badge}
            </span>
          )}
        </span>
      }
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between px-4 py-2">
          <p aria-live="polite" className="text-caption text-fg-muted">
            {s.unread > 0 ? t('unread', { count: s.unread }) : t('allRead')}
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={s.unread === 0}
            onClick={() => void readAll()}
          >
            {t('readAll')}
          </Button>
        </div>
        {s.status === 'loading' && s.items.length === 0 && (
          <div aria-busy="true" className="flex flex-col gap-2 px-4 pb-4">
            <span className="sr-only">{t('loading')}</span>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )}
        {s.status === 'error' && (
          <p role="alert" className="px-4 pb-3 text-body-sm text-danger">
            {t('error')}
          </p>
        )}
        {s.status !== 'loading' && s.items.length === 0 && s.status !== 'error' && (
          <p className="px-4 pb-4 text-body-sm text-fg-muted">{t('empty')}</p>
        )}
        <ul className="flex max-h-96 flex-col overflow-y-auto border-t border-border">
          {s.items.map((n) => {
            const href = linkFor(n.type);
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${n.readAt === null ? 'bg-primary' : 'bg-transparent'}`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-body-sm ${n.readAt === null ? 'font-medium text-fg' : 'text-fg-muted'}`}
                  >
                    {t(`types.${n.type}`)}
                    {n.readAt === null && <span className="sr-only"> {t('unreadMark')}</span>}
                  </span>
                  <span className="block text-caption text-fg-subtle tabular-nums">
                    {format.dateTime(new Date(n.createdAt), {
                      day: 'numeric',
                      month: 'long',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </span>
                {href && (
                  <Icon icon="control.chevron-right" size="sm" className="mt-1 text-fg-subtle" />
                )}
              </>
            );
            return (
              <li key={n.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => {
                    void markRead(n);
                    if (href) {
                      setOpen(false);
                      router.push(href);
                    }
                  }}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-surface-sunken focus-visible:focus-ring-inset"
                >
                  {body}
                </button>
              </li>
            );
          })}
        </ul>
        {s.nextCursor && (
          <div className="border-t border-border p-2">
            <Button
              size="sm"
              variant="ghost"
              className="w-full"
              loading={s.status === 'loading'}
              loadingLabel={t('loading')}
              onClick={() => void load(s.nextCursor ?? undefined)}
            >
              {t('loadMore')}
            </Button>
          </div>
        )}
      </div>
    </Popover>
  );
}
