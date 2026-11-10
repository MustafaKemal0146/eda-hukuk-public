'use client';
// Takvim (053-07): ay, hafta ve ajanda görünümü gerçek etkinliklerle çalışır (api `/calendar/events`).
// Etkinlik elle eklenir/düzenlenir/silinir/tamamlanır; süre kaynaklı (deadline) etkinlikler süre
// motorundan gelir ve zamanı kilitlidir (silinmez).
import type { CalendarEventDtoValue } from '@eda/contracts/api/calendar';
import {
  AlertDialog,
  Button,
  Card,
  ErrorState,
  IconButton,
  PageContainer,
  SegmentedControl,
  Skeleton,
} from '@eda/ui';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiClientError, authRedirectFor, documentsApi } from '../studio/documents-api.ts';
import { EventDialog } from './event-dialog.tsx';
import { isoDate, monthGrid } from './month.ts';
import {
  addDays,
  type CalendarView,
  groupByDay,
  rangeOf,
  shiftAnchor,
  timeText,
  weekStart,
} from './range.ts';

const TYPE_DOT: Record<string, string> = {
  hearing: 'bg-danger',
  deadline: 'bg-warning',
  discovery: 'bg-info',
  expert: 'bg-info',
  meeting: 'bg-success',
  mediation: 'bg-success',
  task: 'bg-violet-border',
};
const LEGEND = [
  'hearing',
  'deadline',
  'discovery',
  'expert',
  'meeting',
  'mediation',
  'task',
] as const;
const MAX_CHIPS = 3;

type Load = 'loading' | 'ready' | 'error' | 'locked';

export function CalendarHome() {
  const t = useTranslations('calendar');
  const format = useFormatter();
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const [view, setView] = useState<CalendarView>('month');
  const [anchor, setAnchor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState(() => today);
  const [events, setEvents] = useState<CalendarEventDtoValue[]>([]);
  const [load, setLoad] = useState<Load>('loading');
  const [dialog, setDialog] = useState<{ open: boolean; event: CalendarEventDtoValue | null }>({
    open: false,
    event: null,
  });
  const [toDelete, setToDelete] = useState<CalendarEventDtoValue | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [actionError, setActionError] = useState(false);

  const range = useMemo(() => rangeOf(view, anchor), [view, anchor]);
  const fromKey = range.from.getTime();
  const toKey = range.to.getTime();

  const fetchEvents = useCallback(async () => {
    setLoad('loading');
    try {
      const r = await documentsApi.calendar.listEvents({
        from: new Date(fromKey).toISOString(),
        to: new Date(toKey).toISOString(),
      });
      setEvents(r.items);
      setLoad('ready');
    } catch (err) {
      const to = authRedirectFor(err, '/takvim');
      if (to) {
        router.replace(to);
        return;
      }
      setLoad(err instanceof ApiClientError && err.status === 403 ? 'locked' : 'error');
    }
  }, [fromKey, toKey, router]);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const byDay = useMemo(() => groupByDay(events), [events]);
  const selectedKey = isoDate(selected);
  const selectedEvents = byDay.get(selectedKey) ?? [];
  const upcoming = useMemo(() => {
    const now = Date.now();
    return events
      .filter(
        (e) =>
          (e.type === 'deadline' || e.type === 'hearing') &&
          e.completedAt === null &&
          e.cancelledAt === null &&
          new Date(e.startsAt).getTime() >= now,
      )
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())
      .slice(0, 5);
  }, [events]);

  const weekdays = t.raw('weekdays') as string[];
  const weekdaysShort = t.raw('weekdaysShort') as string[];
  const allDay = t('allDay');
  const cells = useMemo(
    () => monthGrid(anchor.getFullYear(), anchor.getMonth(), today),
    [anchor, today],
  );

  const title =
    view === 'month'
      ? format.dateTime(anchor, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${format.dateTime(weekStart(anchor), { day: 'numeric', month: 'long' })} – ${format.dateTime(addDays(weekStart(anchor), 6), { day: 'numeric', month: 'long', year: 'numeric' })}`
        : `${format.dateTime(anchor, { day: 'numeric', month: 'long' })} – ${format.dateTime(addDays(range.to, -1), { day: 'numeric', month: 'long', year: 'numeric' })}`;

  const goToday = () => {
    setSelected(today);
    setAnchor(view === 'month' ? new Date(today.getFullYear(), today.getMonth(), 1) : today);
  };
  const changeView = (next: CalendarView) => {
    setView(next);
    setAnchor(
      next === 'month' ? new Date(selected.getFullYear(), selected.getMonth(), 1) : selected,
    );
  };
  const selectDay = (d: Date) => {
    setSelected(d);
    if (view === 'month' && d.getMonth() !== anchor.getMonth()) {
      setAnchor(new Date(d.getFullYear(), d.getMonth(), 1));
    }
  };

  const upsert = (e: CalendarEventDtoValue) =>
    setEvents((cur) =>
      cur.some((x) => x.id === e.id) ? cur.map((x) => (x.id === e.id ? e : x)) : [...cur, e],
    );

  async function toggleDone(e: CalendarEventDtoValue) {
    setActionError(false);
    try {
      upsert(
        await documentsApi.calendar.patchEvent(e.id, {
          completedAt: e.completedAt === null ? new Date().toISOString() : null,
        }),
      );
    } catch {
      setActionError(true);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setActionError(false);
    try {
      await documentsApi.calendar.deleteEvent(toDelete.id);
      setEvents((cur) => cur.filter((x) => x.id !== toDelete.id));
    } catch {
      setActionError(true);
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  }

  const chip = (e: CalendarEventDtoValue, compact = false) => (
    <button
      key={e.id}
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        setSelected(new Date(e.startsAt));
        setDialog({ open: true, event: e });
      }}
      className={`flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left text-caption hover:bg-surface-sunken focus-visible:focus-ring ${
        e.completedAt ? 'text-fg-subtle line-through' : 'text-fg'
      }`}
    >
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${TYPE_DOT[e.type] ?? 'bg-info'}`}
      />
      {!compact && (
        <span className="shrink-0 tabular-nums text-fg-muted">{timeText(e, allDay)}</span>
      )}
      <span className="truncate">{e.title}</span>
    </button>
  );

  const eventRow = (e: CalendarEventDtoValue) => (
    <li key={e.id} className="flex flex-col gap-1 rounded-md border border-border p-3">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={`mt-1.5 size-2 shrink-0 rounded-full ${TYPE_DOT[e.type] ?? 'bg-info'}`}
        />
        <div className="min-w-0 flex-1">
          <p
            className={`text-body-sm font-medium ${e.completedAt ? 'text-fg-subtle line-through' : 'text-fg'}`}
          >
            {e.title}
          </p>
          <p className="text-caption text-fg-muted">
            {t(`types.${e.type}`)} · {timeText(e, allDay)}
            {e.location ? ` · ${e.location}` : ''}
          </p>
          {e.notes && <p className="mt-1 text-caption text-fg-muted">{e.notes}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-1 pl-4">
        <Button size="sm" variant="ghost" onClick={() => void toggleDone(e)}>
          {e.completedAt ? t('reopen') : t('complete')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDialog({ open: true, event: e })}>
          {t('edit')}
        </Button>
        {e.deadlineId === null && (
          <Button size="sm" variant="ghost" onClick={() => setToDelete(e)}>
            {t('delete.action')}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <PageContainer width="content" className="gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body-sm text-fg-subtle">{t('title')}</p>
          <h1 aria-live="polite" className="font-display text-heading-lg text-fg">
            {title}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-md border border-border shadow-1">
            <IconButton
              icon="control.chevron-left"
              label={t('prev')}
              onClick={() => setAnchor((a) => shiftAnchor(view, a, -1))}
              className="rounded-r-none"
            />
            <button
              type="button"
              onClick={goToday}
              className="h-8 border-x border-border px-3 text-body-sm font-medium text-fg hover:bg-surface-sunken focus-visible:focus-ring"
            >
              {t('today')}
            </button>
            <IconButton
              icon="control.chevron-right"
              label={t('next')}
              onClick={() => setAnchor((a) => shiftAnchor(view, a, 1))}
              className="rounded-l-none"
            />
          </div>
          <SegmentedControl
            label={t('view')}
            value={view}
            onValueChange={changeView}
            options={[
              { value: 'month', label: t('month') },
              { value: 'week', label: t('week') },
              { value: 'agenda', label: t('agenda') },
            ]}
          />
          <Button leadingIcon="action.add" onClick={() => setDialog({ open: true, event: null })}>
            {t('add')}
          </Button>
        </div>
      </header>

      {actionError && (
        <p role="alert" className="text-body-sm text-danger">
          {t('actionError')}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-main-panel">
        <Card className="min-w-0 overflow-hidden">
          {load === 'error' && (
            <ErrorState
              title={t('loadError')}
              onRetry={() => void fetchEvents()}
              labels={{
                retry: t('retry'),
                retrying: t('loading'),
                supportCode: '',
                copy: '',
                copied: '',
              }}
            />
          )}
          {load === 'locked' && <p className="p-6 text-body-sm text-fg-muted">{t('locked')}</p>}
          {load === 'loading' && events.length === 0 && (
            <div aria-busy="true" className="flex flex-col gap-2 p-4">
              <span className="sr-only">{t('loading')}</span>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}
          {(load === 'ready' || (load === 'loading' && events.length > 0)) && view === 'month' && (
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">{title}</caption>
              <thead>
                <tr>
                  {weekdays.map((d, i) => (
                    <th
                      key={d}
                      scope="col"
                      abbr={d}
                      className="h-9 border-b border-border bg-surface-sunken px-3 text-left text-caption font-medium text-fg-muted"
                    >
                      <span className="hidden lg:inline">{d}</span>
                      <span className="lg:hidden">{weekdaysShort[i]}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, row) => (
                  <tr key={cells[row * 7]?.key}>
                    {cells.slice(row * 7, row * 7 + 7).map((c) => {
                      const list = byDay.get(c.key) ?? [];
                      const isSel = c.key === selectedKey;
                      return (
                        // biome-ignore lint/a11y/useKeyWithClickEvents: klavye yolu gün numarası düğmesidir.
                        <td
                          key={c.key}
                          aria-current={c.isToday ? 'date' : undefined}
                          onClick={() => selectDay(c.date)}
                          className={`h-24 cursor-pointer border-r border-b border-border p-1 align-top last:border-r-0 md:h-32 ${
                            c.inMonth ? (c.isWeekend ? 'bg-surface-sunken' : 'bg-surface') : 'bg-bg'
                          } ${isSel ? 'outline outline-2 -outline-offset-2 outline-primary' : ''}`}
                        >
                          <button
                            type="button"
                            aria-label={format.dateTime(c.date, { day: 'numeric', month: 'long' })}
                            className={`ml-0.5 inline-flex size-6 items-center justify-center rounded-full text-caption tabular-nums focus-visible:focus-ring ${
                              c.isToday
                                ? 'bg-primary font-semibold text-on-primary'
                                : c.inMonth
                                  ? 'text-fg'
                                  : 'text-fg-subtle'
                            }`}
                          >
                            {c.date.getDate()}
                          </button>
                          <div className="mt-0.5 flex flex-col gap-0.5">
                            {list.slice(0, MAX_CHIPS).map((e) => chip(e, true))}
                            {list.length > MAX_CHIPS && (
                              <span className="px-1.5 text-caption text-fg-muted">
                                {t('more', { count: list.length - MAX_CHIPS })}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {(load === 'ready' || (load === 'loading' && events.length > 0)) && view === 'week' && (
            <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-7 md:divide-x md:divide-y-0">
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(weekStart(anchor), i);
                const key = isoDate(d);
                const list = byDay.get(key) ?? [];
                return (
                  <section
                    key={key}
                    aria-label={format.dateTime(d, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                    })}
                    className={`min-h-40 p-2 ${key === selectedKey ? 'bg-primary-soft' : ''}`}
                  >
                    <button
                      type="button"
                      onClick={() => selectDay(d)}
                      className="mb-2 block w-full text-left text-caption font-medium text-fg-muted focus-visible:focus-ring"
                    >
                      {weekdaysShort[i]} {d.getDate()}
                    </button>
                    <div className="flex flex-col gap-1">{list.map((e) => chip(e))}</div>
                  </section>
                );
              })}
            </div>
          )}
          {(load === 'ready' || (load === 'loading' && events.length > 0)) && view === 'agenda' && (
            <div className="flex flex-col divide-y divide-border">
              {byDay.size === 0 && (
                <p className="p-6 text-body-sm text-fg-muted">{t('agendaEmpty')}</p>
              )}
              {[...byDay.entries()]
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, list]) => (
                  <section key={key} className="p-4">
                    <h2 className="mb-2 text-body-sm font-medium text-fg">
                      {format.dateTime(new Date(`${key}T00:00:00`), {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </h2>
                    <ul className="flex flex-col gap-2">{list.map(eventRow)}</ul>
                  </section>
                ))}
            </div>
          )}
        </Card>

        <aside className="flex flex-col gap-4">
          <Card className="p-5">
            <p className="text-caption text-fg-subtle">
              {isoDate(selected) === isoDate(today) ? t('todaySummary') : t('daySummary')}
            </p>
            <p className="mt-1 font-display text-heading-md text-fg">
              {format.dateTime(selected, { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            {selectedEvents.length === 0 ? (
              <p className="mt-3 border-t border-border pt-3 text-body-sm text-fg-muted">
                {t('dayEmpty')}
              </p>
            ) : (
              <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                {selectedEvents.map(eventRow)}
              </ul>
            )}
            <Button
              className="mt-3"
              size="sm"
              variant="outline"
              leadingIcon="action.add"
              onClick={() => setDialog({ open: true, event: null })}
            >
              {t('addToDay')}
            </Button>
          </Card>
          <Card className="p-5">
            <h2 className="text-body-sm font-medium text-fg">{t('criticalTitle')}</h2>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-body-sm text-fg-muted">{t('criticalEmpty')}</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {upcoming.map((e) => (
                  <li key={e.id} className="text-body-sm text-fg">
                    <span className="tabular-nums text-fg-muted">
                      {format.dateTime(new Date(e.startsAt), { day: 'numeric', month: 'short' })}
                    </span>{' '}
                    {e.title}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 rounded-md bg-surface-sunken px-3 py-2 text-caption text-fg-muted">
              {t('engineNote')}
            </p>
          </Card>
          <Card className="p-5">
            <h2 className="text-body-sm font-medium text-fg">{t('legend')}</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {LEGEND.map((k) => (
                <li key={k} className="flex items-center gap-2.5 text-body-sm text-fg-muted">
                  <span aria-hidden="true" className={`size-2 rounded-full ${TYPE_DOT[k]}`} />
                  {t(`types.${k}`)}
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>

      <EventDialog
        open={dialog.open}
        initial={dialog.event}
        day={selected}
        onClose={() => setDialog({ open: false, event: null })}
        onSaved={(e) => {
          upsert(e);
          setDialog({ open: false, event: null });
        }}
        onAuth={(to) => router.replace(to)}
      />
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(o) => {
          if (!o) setToDelete(null);
        }}
        title={t('delete.title')}
        description={t('delete.description', { title: toDelete?.title ?? '' })}
        impact={t('delete.impact')}
        cancelLabel={t('delete.cancel')}
        destructiveLabel={t('delete.confirm')}
        confirmLoading={deleting}
        confirmLoadingLabel={t('delete.confirm')}
        onConfirm={() => void confirmDelete()}
      />
    </PageContainer>
  );
}
