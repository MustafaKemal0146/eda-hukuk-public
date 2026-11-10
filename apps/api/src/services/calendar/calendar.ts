// Takvim servisi (041 §6; P22 KB ilk dilim): elle etkinlik listele/oluştur/güncelle/sil ve etkinliğe
// bağlı hatırlatıcı satırları. Süre kaynaklı (`type = deadline`) etkinlikler `POST /deadlines` ile
// gelir (sonraki dilim); burada zaman alanları kilitlidir ve silinmez. Başlık ve not günlüğe,
// span'a ve kuyruğa yazılmaz (Y-63). Hono bilmez.
import type {
  CalendarEventDtoValue,
  EventInputValue,
  EventListResponseValue,
  EventPatchInputValue,
  ListEventsQueryValue,
} from '@eda/contracts/api/calendar';
import { CONFIG_DEFAULTS } from '@eda/contracts/config/defaults';
import type { MemberRole, NotificationChannel, ReminderStatus } from '@eda/contracts/enums';
import { AppError } from '@eda/contracts/errors';
import { can } from '@eda/contracts/permissions';
import type { TenantTx } from '@eda/db';
import * as repo from '../../repositories/calendar/events.ts';

export interface CalendarDb {
  withTenant<T>(
    ctx: { orgId: string; userId: string },
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T>;
}

export interface CalendarActor {
  readonly orgId: string;
  readonly userId: string;
  readonly memberRole: MemberRole;
}

export interface CalendarServiceDeps {
  readonly db: CalendarDb;
  readonly now?: () => Date;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 86_400_000;

const notFound = () => new AppError('CAL_EVENT_NOT_FOUND');
const derived = () => new AppError('VALIDATION_FAILED', { reason: 'deadline_derived_event' });

function dto(e: repo.EventRow, reminders: repo.ReminderRow[]): CalendarEventDtoValue {
  return {
    id: e.id,
    type: e.type as CalendarEventDtoValue['type'],
    title: e.title,
    caseId: e.caseId,
    deadlineId: e.deadlineId,
    userId: e.userId,
    location: e.location,
    courtCode: e.courtCode,
    esasNo: e.esasNo,
    notes: e.notes,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt?.toISOString() ?? null,
    allDay: e.allDay,
    timezone: e.timezone,
    completedAt: e.completedAt?.toISOString() ?? null,
    cancelledAt: e.cancelledAt?.toISOString() ?? null,
    reminders: reminders
      .filter((r) => r.calendarEventId === e.id)
      .map((r) => ({
        id: r.id,
        calendarEventId: r.calendarEventId,
        deadlineId: r.deadlineId,
        remindAt: r.remindAt.toISOString(),
        channel: r.channel as NotificationChannel,
        status: r.status as ReminderStatus,
        sentAt: r.sentAt?.toISOString() ?? null,
      })),
  };
}

export function createCalendarService(deps: CalendarServiceDeps) {
  const now = deps.now ?? (() => new Date());
  const tenant = <T>(a: CalendarActor, fn: (tx: TenantTx) => Promise<T>) =>
    deps.db.withTenant({ orgId: a.orgId, userId: a.userId }, fn);
  const guard = (a: CalendarActor, perm: 'calendar:read' | 'calendar:write') => {
    if (!can({ surface: 'app', memberRole: a.memberRole }, perm).allow) {
      throw new AppError('ORG_ROLE_INSUFFICIENT');
    }
  };

  async function reminderRows(
    tx: TenantTx,
    a: CalendarActor,
    events: readonly repo.EventRow[],
  ): Promise<repo.ReminderRow[]> {
    return repo.remindersFor(
      tx,
      a.orgId,
      a.userId,
      events.map((e) => e.id),
    );
  }

  async function scheduleReminders(
    tx: TenantTx,
    a: CalendarActor,
    event: repo.EventRow,
    specs: readonly { offsetMinutes: number; channel: string }[],
  ): Promise<void> {
    const limit = CONFIG_DEFAULTS['reminders.maxPerTarget'];
    if (specs.length > limit) {
      throw new AppError('VALIDATION_FAILED', { reason: 'reminder_limit_reached' });
    }
    for (const s of specs) {
      const at = new Date(event.startsAt.getTime() - s.offsetMinutes * 60_000);
      // Geçmişe düşen hatırlatıcı kurulmaz (gönderilemez).
      if (at.getTime() <= now().getTime()) continue;
      await repo.insertReminder(tx, a.orgId, a.userId, event.id, at, s.channel);
    }
  }

  return {
    async list(a: CalendarActor, q: ListEventsQueryValue): Promise<EventListResponseValue> {
      guard(a, 'calendar:read');
      const from = new Date(q.from);
      const to = new Date(q.to);
      if (
        Number.isNaN(from.getTime()) ||
        Number.isNaN(to.getTime()) ||
        from > to ||
        to.getTime() - from.getTime() > CONFIG_DEFAULTS['calendar.rangeMaxDays'] * DAY_MS
      ) {
        throw new AppError('VALIDATION_FAILED', { reason: 'event_date_out_of_range' });
      }
      return tenant(a, async (tx) => {
        if (q.caseId !== undefined && !(await repo.caseExists(tx, a.orgId, q.caseId))) {
          throw new AppError('CASE_NOT_FOUND');
        }
        const events = await repo.listEvents(tx, a.orgId, { from, to, caseId: q.caseId });
        const reminders = await reminderRows(tx, a, events);
        return { items: events.map((e) => dto(e, reminders)) };
      });
    },

    async create(a: CalendarActor, input: EventInputValue): Promise<CalendarEventDtoValue> {
      guard(a, 'calendar:write');
      const startsAt = new Date(input.startsAt);
      const endsAt =
        input.endsAt === null || input.endsAt === undefined ? null : new Date(input.endsAt);
      if (endsAt !== null && endsAt <= startsAt) throw new AppError('CAL_INVALID_RANGE');
      return tenant(a, async (tx) => {
        const caseId = input.caseId ?? null;
        if (caseId !== null && !(await repo.caseExists(tx, a.orgId, caseId))) {
          throw new AppError('CASE_NOT_FOUND');
        }
        const row = await repo.insertEvent(tx, a.orgId, {
          userId: a.userId,
          caseId,
          type: input.type,
          title: input.title.trim(),
          location: input.location ?? null,
          courtCode: input.courtCode ?? null,
          esasNo: input.esasNo ?? null,
          notes: input.notes ?? null,
          startsAt,
          endsAt,
          allDay: input.allDay,
          timezone: input.timezone ?? 'Europe/Istanbul',
        });
        await scheduleReminders(tx, a, row, input.reminders ?? []);
        return dto(row, await reminderRows(tx, a, [row]));
      });
    },

    async patch(
      a: CalendarActor,
      eventId: string,
      input: EventPatchInputValue,
    ): Promise<CalendarEventDtoValue> {
      guard(a, 'calendar:write');
      if (!UUID_RE.test(eventId)) throw notFound();
      return tenant(a, async (tx) => {
        const cur = await repo.getEvent(tx, a.orgId, eventId, true);
        if (cur === null) throw notFound();
        const timeChange =
          input.startsAt !== undefined ||
          input.endsAt !== undefined ||
          input.allDay !== undefined ||
          input.timezone !== undefined;
        if (cur.deadlineId !== null && timeChange) throw derived();
        const startsAt = input.startsAt === undefined ? cur.startsAt : new Date(input.startsAt);
        const endsAt =
          input.endsAt === undefined
            ? cur.endsAt
            : input.endsAt === null
              ? null
              : new Date(input.endsAt);
        if (endsAt !== null && endsAt <= startsAt) throw new AppError('CAL_INVALID_RANGE');
        if (
          input.caseId !== undefined &&
          input.caseId !== null &&
          !(await repo.caseExists(tx, a.orgId, input.caseId))
        ) {
          throw new AppError('CASE_NOT_FOUND');
        }
        const row = await repo.patchEvent(tx, a.orgId, eventId, {
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          ...(input.caseId === undefined ? {} : { caseId: input.caseId }),
          ...(input.location === undefined ? {} : { location: input.location }),
          ...(input.courtCode === undefined ? {} : { courtCode: input.courtCode }),
          ...(input.esasNo === undefined ? {} : { esasNo: input.esasNo }),
          ...(input.notes === undefined ? {} : { notes: input.notes }),
          ...(input.startsAt === undefined ? {} : { startsAt }),
          ...(input.endsAt === undefined ? {} : { endsAt }),
          ...(input.allDay === undefined ? {} : { allDay: input.allDay }),
          ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
          ...(input.completedAt === undefined
            ? {}
            : { completedAt: input.completedAt === null ? null : new Date(input.completedAt) }),
        });
        if (row === null) throw notFound();
        if (input.startsAt !== undefined && startsAt.getTime() !== cur.startsAt.getTime()) {
          // Zaman değişince zamanlanmış hatırlatıcılar yeni başlangıca göre kaydırılır.
          const old = await repo.remindersFor(tx, a.orgId, a.userId, [eventId]);
          await repo.deleteScheduledReminders(tx, a.orgId, a.userId, eventId);
          const shift = startsAt.getTime() - cur.startsAt.getTime();
          for (const r of old) {
            if (r.status !== 'scheduled') continue;
            const at = new Date(r.remindAt.getTime() + shift);
            if (at.getTime() > now().getTime()) {
              await repo.insertReminder(tx, a.orgId, a.userId, eventId, at, r.channel);
            }
          }
        }
        return dto(row, await reminderRows(tx, a, [row]));
      });
    },

    async remove(a: CalendarActor, eventId: string): Promise<void> {
      guard(a, 'calendar:write');
      if (!UUID_RE.test(eventId)) throw notFound();
      await tenant(a, async (tx) => {
        const cur = await repo.getEvent(tx, a.orgId, eventId, true);
        if (cur === null) throw notFound();
        if (cur.deadlineId !== null) throw derived();
        if (!(await repo.deleteEvent(tx, a.orgId, eventId))) throw notFound();
      });
    },
  };
}

export type CalendarService = ReturnType<typeof createCalendarService>;
