// `app` takvim, süre, bildirim (030 §9) + `notification_preferences` (045 §13.1). Süreyi LLM değil
// `@eda/legal` süre motoru hesaplar; `deadlines` avukat onaylı kayıttır. `reminders` fillfactor = 90
// ve `ON DELETE SET NULL (kolon)` migrasyonda yamadır.
import {
  CALENDAR_EVENT_TYPES,
  DEADLINE_START_EVENTS,
  DEADLINE_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  REMINDER_STATUSES,
  SERVICE_METHODS,
} from '@eda/contracts/enums';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  primaryKey,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { inList, sqlValueList } from '../_checks.ts';
import { col, createdAt, fk, idV7, tstz, updatedAt } from '../_columns.ts';
import { organizations, users } from '../auth.ts';
import { cases, files } from './case.ts';
import { courts, deadlineRules } from './catalog.ts';
import { appSchema } from './partners.ts';

const notNull = (name: string) => sql`${col(name)} IS NOT NULL`;
const orgIdRef = () =>
  uuid('org_id')
    .notNull()
    .references(() => organizations.id);

/** Avukat onaylı süreler (defter §28.13 A); hesap izi `calculation`. */
export const deadlines = appSchema.table(
  'deadlines',
  {
    id: idV7(),
    orgId: orgIdRef(),
    caseId: uuid('case_id'),
    sourceFileId: uuid('source_file_id'),
    ruleId: uuid('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    startEvent: text('start_event').notNull(),
    eventDate: date('event_date', { mode: 'string' }).notNull(),
    serviceMethod: text('service_method'),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    dueAt: tstz('due_at').notNull(),
    safeDueAt: tstz('safe_due_at'),
    contestedDueDate: date('contested_due_date', { mode: 'string' }),
    calculation: jsonb('calculation').notNull(),
    engineVersion: text('engine_version').notNull(),
    evidenceQuote: text('evidence_quote'),
    status: text('status').notNull().default('open'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: tstz('approved_at').notNull().defaultNow(),
    filedDeclaredBy: uuid('filed_declared_by').references(() => users.id, {
      onDelete: 'set null',
    }),
    filedDeclaredAt: tstz('filed_declared_at'),
    cancelledAt: tstz('cancelled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('deadlines', t.startEvent, DEADLINE_START_EVENTS),
    inList('deadlines', t.serviceMethod, SERVICE_METHODS),
    inList('deadlines', t.status, DEADLINE_STATUSES),
    unique('deadlines_org_id_uq').on(t.orgId, t.id),
    check(
      'deadlines_filed_chk',
      sql`(${col('status')} = 'filed_declared') = (${col('filed_declared_at')} IS NOT NULL)`,
    ),
    check(
      'deadlines_e_tebligat_chk',
      sql`${col('start_event')} = 'service' OR ${col('service_method')} IS NULL`,
    ),
    fk('deadlines_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]),
    fk('deadlines_source_file_fk', [t.orgId, t.sourceFileId], [files.orgId, files.id]).onDelete(
      'set null',
    ),
    fk('deadlines_rule_fk', [t.ruleId, t.ruleVersion], [deadlineRules.id, deadlineRules.version]),
    index('deadlines_open_idx')
      .on(t.orgId, t.dueDate)
      .where(sql`${col('status')} IN (${sqlValueList(['open'])})`),
    index('deadlines_case_idx').on(t.orgId, t.caseId, t.dueDate).where(notNull('case_id')),
    index('deadlines_file_idx').on(t.orgId, t.sourceFileId).where(notNull('source_file_id')),
    index('deadlines_rule_idx').on(t.ruleId),
    index('deadlines_approved_by_idx').on(t.approvedBy).where(notNull('approved_by')),
    index('deadlines_filed_declared_by_idx')
      .on(t.filedDeclaredBy)
      .where(notNull('filed_declared_by')),
  ],
);

/** Takvim etkinlikleri (davasız etkinlik kişiseldir; 031 §6.3). */
export const calendarEvents = appSchema.table(
  'calendar_events',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    caseId: uuid('case_id'),
    deadlineId: uuid('deadline_id'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    location: text('location'),
    courtCode: text('court_code').references(() => courts.code),
    esasNo: text('esas_no'),
    notes: text('notes'),
    startsAt: tstz('starts_at').notNull(),
    endsAt: tstz('ends_at'),
    allDay: boolean('all_day').notNull().default(false),
    timezone: text('timezone').notNull().default('Europe/Istanbul'),
    completedAt: tstz('completed_at'),
    cancelledAt: tstz('cancelled_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    inList('calendar_events', t.type, CALENDAR_EVENT_TYPES),
    check('calendar_events_esas_no_chk', sql`char_length(${col('esas_no')}) <= 32`),
    unique('calendar_events_org_id_uq').on(t.orgId, t.id),
    check(
      'calendar_events_range_chk',
      sql`${col('ends_at')} IS NULL OR ${col('ends_at')} > ${col('starts_at')}`,
    ),
    fk('calendar_events_case_fk', [t.orgId, t.caseId], [cases.orgId, cases.id]),
    fk(
      'calendar_events_deadline_fk',
      [t.orgId, t.deadlineId],
      [deadlines.orgId, deadlines.id],
    ).onDelete('cascade'),
    index('calendar_events_org_time_idx').on(t.orgId, t.startsAt),
    index('calendar_events_user_time_idx').on(t.orgId, t.userId, t.startsAt),
    index('calendar_events_case_idx').on(t.orgId, t.caseId, t.startsAt).where(notNull('case_id')),
    index('calendar_events_deadline_idx').on(t.orgId, t.deadlineId).where(notNull('deadline_id')),
    index('calendar_events_user_idx').on(t.userId),
    index('calendar_events_created_by_idx').on(t.createdBy).where(notNull('created_by')),
  ],
);

/** Hatırlatıcılar (varsayılan zamanlar `reminders.defaultMinutes`'ten satır olarak). */
export const reminders = appSchema.table(
  'reminders',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    calendarEventId: uuid('calendar_event_id'),
    deadlineId: uuid('deadline_id'),
    remindAt: tstz('remind_at').notNull(),
    channel: text('channel').notNull(),
    status: text('status').notNull().default('scheduled'),
    attempts: integer('attempts').notNull().default(0),
    sentAt: tstz('sent_at'),
    lastErrorCode: text('last_error_code'),
    createdAt: createdAt(),
  },
  (t) => [
    inList('reminders', t.channel, NOTIFICATION_CHANNELS),
    inList('reminders', t.status, REMINDER_STATUSES),
    check(
      'reminders_target_chk',
      sql`num_nonnulls(${col('calendar_event_id')}, ${col('deadline_id')}) = 1`,
    ),
    unique('reminders_uq')
      .on(t.orgId, t.userId, t.calendarEventId, t.deadlineId, t.channel, t.remindAt)
      .nullsNotDistinct(),
    fk(
      'reminders_calendar_event_fk',
      [t.orgId, t.calendarEventId],
      [calendarEvents.orgId, calendarEvents.id],
    ).onDelete('cascade'),
    fk('reminders_deadline_fk', [t.orgId, t.deadlineId], [deadlines.orgId, deadlines.id]).onDelete(
      'cascade',
    ),
    index('reminders_due_idx')
      .on(t.remindAt)
      .where(sql`${col('status')} IN (${sqlValueList(['scheduled'])})`),
    index('reminders_event_idx').on(t.orgId, t.calendarEventId).where(notNull('calendar_event_id')),
    index('reminders_dl_idx').on(t.orgId, t.deadlineId).where(notNull('deadline_id')),
    index('reminders_user_idx').on(t.userId),
  ],
);

/** Web Push abonelikleri (`withUserScope`). */
export const pushSubscriptions = appSchema.table(
  'push_subscriptions',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    endpointHost: text('endpoint_host').notNull(),
    p256dh: text('p256dh').notNull(),
    authSecret: text('auth_secret').notNull(),
    deviceLabel: text('device_label'),
    lastSuccessAt: tstz('last_success_at'),
    failureCount: integer('failure_count').notNull().default(0),
    disabledAt: tstz('disabled_at'),
    createdAt: createdAt(),
  },
  (t) => [
    check('push_subscriptions_endpoint_chk', sql`${col('endpoint')} LIKE 'https://%'`),
    unique('push_subscriptions_uq').on(t.orgId, t.userId, t.endpoint),
    index('push_subscriptions_user_idx').on(t.userId),
  ],
);

/** Uygulama içi bildirimler; `payload` yalnız kimlik ve izinli alanlar (taraf adı YOK). */
export const notifications = appSchema.table(
  'notifications',
  {
    id: idV7(),
    orgId: orgIdRef(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default(sql`'{}'::jsonb`),
    readAt: tstz('read_at'),
    createdAt: createdAt(),
  },
  (t) => [
    inList('notifications', t.type, NOTIFICATION_TYPES),
    index('notifications_user_idx').on(t.orgId, t.userId, t.createdAt.desc()),
    index('notifications_unread_idx')
      .on(t.orgId, t.userId)
      .where(sql`${col('read_at')} IS NULL`),
    index('notifications_retention_due_idx')
      .on(sql`(${col('payload')} ->> 'caseId')`)
      .where(sql`${col('type')} IN (${sqlValueList(['retention_due'])})`),
    index('notifications_owner_idx').on(t.userId),
  ],
);

/** Kullanıcı bildirim kanal tercihleri (seyrek geçersiz kılma; `withUserScope`; 045 §13.1). */
export const notificationPreferences = appSchema.table(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ name: 'notification_preferences_pkey', columns: [t.userId, t.kind, t.channel] }),
    inList('notification_preferences', t.kind, NOTIFICATION_TYPES),
    inList('notification_preferences', t.channel, NOTIFICATION_CHANNELS),
  ],
);

export type Deadline = typeof deadlines.$inferSelect;
export type CalendarEvent = typeof calendarEvents.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type NotificationPreference = typeof notificationPreferences.$inferSelect;
