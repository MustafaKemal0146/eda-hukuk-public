// `app.calendar_events` ve `app.reminders` deposu (030 §9; P22 KB). Her fonksiyon çağıranın
// `withTenant` işlemini alır; RLS satır erişimini sınırlar (davasız etkinlik kişiseldir, 031 §6.3).
// SQL yalnız burada yazılır.
import type { TenantTx } from '@eda/db';

const COLS = `e.id, e.type, e.title, e.case_id, e.deadline_id, e.user_id, e.location, e.court_code,
  e.esas_no, e.notes, e.starts_at, e.ends_at, e.all_day, e.timezone, e.completed_at, e.cancelled_at`;

export interface EventRow {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly caseId: string | null;
  readonly deadlineId: string | null;
  readonly userId: string;
  readonly location: string | null;
  readonly courtCode: string | null;
  readonly esasNo: string | null;
  readonly notes: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly allDay: boolean;
  readonly timezone: string;
  readonly completedAt: Date | null;
  readonly cancelledAt: Date | null;
}

export interface ReminderRow {
  readonly id: string;
  readonly calendarEventId: string | null;
  readonly deadlineId: string | null;
  readonly remindAt: Date;
  readonly channel: string;
  readonly status: string;
  readonly sentAt: Date | null;
}

const d = (v: unknown): Date => (v instanceof Date ? v : new Date(String(v)));
const dn = (v: unknown): Date | null => (v === null || v === undefined ? null : d(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

function eventFrom(r: Record<string, unknown>): EventRow {
  return {
    id: String(r.id),
    type: String(r.type),
    title: String(r.title),
    caseId: s(r.case_id),
    deadlineId: s(r.deadline_id),
    userId: String(r.user_id),
    location: s(r.location),
    courtCode: s(r.court_code),
    esasNo: s(r.esas_no),
    notes: s(r.notes),
    startsAt: d(r.starts_at),
    endsAt: dn(r.ends_at),
    allDay: r.all_day === true,
    timezone: String(r.timezone),
    completedAt: dn(r.completed_at),
    cancelledAt: dn(r.cancelled_at),
  };
}

function reminderFrom(r: Record<string, unknown>): ReminderRow {
  return {
    id: String(r.id),
    calendarEventId: s(r.calendar_event_id),
    deadlineId: s(r.deadline_id),
    remindAt: d(r.remind_at),
    channel: String(r.channel),
    status: String(r.status),
    sentAt: dn(r.sent_at),
  };
}

export async function caseExists(tx: TenantTx, orgId: string, caseId: string): Promise<boolean> {
  const r = await tx.query('SELECT 1 FROM app.cases WHERE org_id = $1 AND id = $2', [
    orgId,
    caseId,
  ]);
  return r.rows.length > 0;
}

/** Aralıkla kesişen, iptal edilmemiş etkinlikler (başlangıca göre). */
export async function listEvents(
  tx: TenantTx,
  orgId: string,
  q: { from: Date; to: Date; caseId?: string | undefined },
): Promise<EventRow[]> {
  const r = await tx.query(
    `SELECT ${COLS}
       FROM app.calendar_events e
      WHERE e.org_id = $1
        AND e.cancelled_at IS NULL
        AND e.starts_at < $3
        AND COALESCE(e.ends_at, e.starts_at) >= $2
        AND ($4::uuid IS NULL OR e.case_id = $4)
      ORDER BY e.starts_at, e.id
      LIMIT 1000`,
    [orgId, q.from, q.to, q.caseId ?? null],
  );
  return r.rows.map((x) => eventFrom(x as Record<string, unknown>));
}

export async function getEvent(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  lock = false,
): Promise<EventRow | null> {
  const r = await tx.query(
    `SELECT ${COLS} FROM app.calendar_events e
      WHERE e.org_id = $1 AND e.id = $2 ${lock ? 'FOR UPDATE OF e' : ''}`,
    [orgId, eventId],
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : eventFrom(row);
}

export interface InsertEvent {
  readonly userId: string;
  readonly caseId: string | null;
  readonly type: string;
  readonly title: string;
  readonly location: string | null;
  readonly courtCode: string | null;
  readonly esasNo: string | null;
  readonly notes: string | null;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly allDay: boolean;
  readonly timezone: string;
}

export async function insertEvent(tx: TenantTx, orgId: string, v: InsertEvent): Promise<EventRow> {
  const r = await tx.query(
    `INSERT INTO app.calendar_events AS e
       (org_id, user_id, created_by, case_id, type, title, location, court_code, esas_no, notes,
        starts_at, ends_at, all_day, timezone)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${COLS}`,
    [
      orgId,
      v.userId,
      v.caseId,
      v.type,
      v.title,
      v.location,
      v.courtCode,
      v.esasNo,
      v.notes,
      v.startsAt,
      v.endsAt,
      v.allDay,
      v.timezone,
    ],
  );
  return eventFrom(r.rows[0] as Record<string, unknown>);
}

export interface EventPatch {
  readonly title?: string;
  readonly caseId?: string | null;
  readonly location?: string | null;
  readonly courtCode?: string | null;
  readonly esasNo?: string | null;
  readonly notes?: string | null;
  readonly startsAt?: Date;
  readonly endsAt?: Date | null;
  readonly allDay?: boolean;
  readonly timezone?: string;
  readonly completedAt?: Date | null;
}

const PATCH_COLS: Record<keyof EventPatch, string> = {
  title: 'title',
  caseId: 'case_id',
  location: 'location',
  courtCode: 'court_code',
  esasNo: 'esas_no',
  notes: 'notes',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  allDay: 'all_day',
  timezone: 'timezone',
  completedAt: 'completed_at',
};

export async function patchEvent(
  tx: TenantTx,
  orgId: string,
  eventId: string,
  patch: EventPatch,
): Promise<EventRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [orgId, eventId];
  for (const key of Object.keys(PATCH_COLS) as (keyof EventPatch)[]) {
    if (patch[key] === undefined) continue;
    params.push(patch[key]);
    sets.push(`${PATCH_COLS[key]} = $${params.length}`);
  }
  if (sets.length === 0) return getEvent(tx, orgId, eventId);
  const r = await tx.query(
    `UPDATE app.calendar_events e SET ${sets.join(', ')}, updated_at = now()
      WHERE e.org_id = $1 AND e.id = $2
      RETURNING ${COLS}`,
    params,
  );
  const row = r.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : eventFrom(row);
}

export async function deleteEvent(tx: TenantTx, orgId: string, eventId: string): Promise<boolean> {
  const r = await tx.query('DELETE FROM app.calendar_events WHERE org_id = $1 AND id = $2', [
    orgId,
    eventId,
  ]);
  return (r.rowCount ?? 0) > 0;
}

export async function insertReminder(
  tx: TenantTx,
  orgId: string,
  userId: string,
  eventId: string,
  remindAt: Date,
  channel: string,
): Promise<void> {
  await tx.query(
    `INSERT INTO app.reminders (org_id, user_id, calendar_event_id, remind_at, channel)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING`,
    [orgId, userId, eventId, remindAt, channel],
  );
}

/** Etkinlik kümesinin hatırlatıcıları (RLS: yalnız çağıranın kendi satırları). */
export async function remindersFor(
  tx: TenantTx,
  orgId: string,
  userId: string,
  eventIds: readonly string[],
): Promise<ReminderRow[]> {
  if (eventIds.length === 0) return [];
  const r = await tx.query(
    `SELECT id, calendar_event_id, deadline_id, remind_at, channel, status, sent_at
       FROM app.reminders
      WHERE org_id = $1 AND user_id = $2 AND calendar_event_id = ANY($3::uuid[])
      ORDER BY remind_at`,
    [orgId, userId, eventIds],
  );
  return r.rows.map((x) => reminderFrom(x as Record<string, unknown>));
}

/** Etkinliğin zamanlanmış hatırlatıcılarını siler (zaman değişince yeniden kurulur). */
export async function deleteScheduledReminders(
  tx: TenantTx,
  orgId: string,
  userId: string,
  eventId: string,
): Promise<void> {
  await tx.query(
    `DELETE FROM app.reminders
      WHERE org_id = $1 AND user_id = $2 AND calendar_event_id = $3 AND status = 'scheduled'`,
    [orgId, userId, eventId],
  );
}
